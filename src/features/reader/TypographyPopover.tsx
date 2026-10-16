// Panneau « Mise en page et affichage » du lecteur (bouton « Aa » de la barre du haut) :
// Présentation (défilement continu, feuilles, page par page), Typographie, Livre, Numéros de page, Thème.
// Chaque section se replie ; l'état replié et la position de défilement du panneau sont mémorisés
// (localStorage, propre à cet ordinateur). Clavier : Tab, flèches dans les choix, Échap ferme.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useFloating } from '../../components/ui';
import type { PagedSpread, ReaderLayout, Settings, ThemeId } from '../../lib/types';
import { readerDisplay, type PageMarkStyle } from './display';
import './reader-tools.css';
import './reader-panel.css';

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Système' },
  { id: 'light', label: 'Clair' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'dark', label: 'Sombre' },
];

const LAYOUTS: { id: ReaderLayout; label: string; sub: string }[] = [
  { id: 'scroll', label: 'Défilement continu', sub: 'Le texte se déroule d’un seul tenant, sans coupure de page.' },
  { id: 'sheets', label: 'Feuilles', sub: 'Une feuille par page, l’une sous l’autre, folio en bas.' },
  { id: 'paged', label: 'Page par page', sub: 'Une page à l’écran à la fois : on la tourne comme dans un livre.' },
];

const SPREADS: { id: PagedSpread; label: string; sub: string }[] = [
  { id: 'single', label: 'Une page', sub: 'Toujours une seule page à l’écran.' },
  { id: 'double', label: 'Deux pages', sub: 'Deux pages en vis-à-vis, comme un livre ouvert.' },
  { id: 'auto', label: 'Automatique', sub: 'Deux pages quand la fenêtre est assez large, sinon une.' },
];

const MARK_STYLES: { id: Exclude<PageMarkStyle, 'off'>; label: string }[] = [
  { id: 'numbered', label: 'Trait et numéro' },
  { id: 'number', label: 'Numéro seul' },
];

type SectionId = 'presentation' | 'typo' | 'livre' | 'pages' | 'theme';

// ── Mémoire locale (try/catch : stockage indisponible = valeurs par défaut) ──
const LS_COLLAPSED = 'marginalia.readerPanel.collapsed';
const LS_SCROLL = 'marginalia.readerPanel.scroll';
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* rien */
  }
}
function loadCollapsed(): SectionId[] {
  try {
    const v = JSON.parse(lsGet(LS_COLLAPSED) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ── Pictogrammes (traits en currentColor, papier en var(--bg-page)) ──
function LayoutPicto({ id }: { id: ReaderLayout }) {
  const line = (x1: number, x2: number, y: number, k = 0) => <line key={`${y}-${k}`} x1={x1} x2={x2} y1={y} y2={y} />;
  if (id === 'scroll')
    return (
      <svg viewBox="0 0 44 30" aria-hidden="true" className="rp-picto">
        <g className="rp-picto-text">{[4, 8, 12, 16, 20, 24, 28].map((y, i) => line(9, i % 3 === 2 ? 25 : 31, y, i))}</g>
        <line className="rp-picto-track" x1="38" x2="38" y1="3" y2="27" />
        <line className="rp-picto-thumb" x1="38" x2="38" y1="7" y2="14" />
      </svg>
    );
  if (id === 'sheets')
    return (
      <svg viewBox="0 0 44 30" aria-hidden="true" className="rp-picto">
        <path className="rp-picto-sheet" d="M11 -1 V11.5 a1 1 0 0 0 1 1 H32 a1 1 0 0 0 1 -1 V-1" />
        <g className="rp-picto-text">{[2.5, 6].map((y) => line(15, 29, y))}</g>
        <line className="rp-picto-folio" x1="21" x2="23" y1="9.5" y2="9.5" />
        <path className="rp-picto-sheet" d="M11 31 V18.5 a1 1 0 0 1 1 -1 H32 a1 1 0 0 1 1 1 V31" />
        <g className="rp-picto-text">{[22, 25.5, 29].map((y) => line(15, 29, y))}</g>
      </svg>
    );
  return (
    <svg viewBox="0 0 44 30" aria-hidden="true" className="rp-picto">
      <rect className="rp-picto-sheet" x="13" y="2" width="18" height="26" rx="1.2" />
      <g className="rp-picto-text">{[6.5, 10, 13.5, 17, 20.5].map((y, i) => line(16.5, i === 4 ? 24 : 27.5, y))}</g>
      <line className="rp-picto-folio" x1="21" x2="23" y1="25" y2="25" />
      <path className="rp-picto-arrow" d="M7.5 12 l-3 3 l3 3 M36.5 12 l3 3 l-3 3" />
    </svg>
  );
}

function SpreadPicto({ id }: { id: PagedSpread }) {
  return (
    <svg viewBox="0 0 26 18" aria-hidden="true" className="rp-picto-sm">
      {id === 'single' && <rect className="rp-picto-sheet" x="8" y="1.5" width="10" height="15" rx="1" />}
      {id === 'double' && (
        <>
          <rect className="rp-picto-sheet" x="2.5" y="1.5" width="10" height="15" rx="1" />
          <rect className="rp-picto-sheet" x="13.5" y="1.5" width="10" height="15" rx="1" />
        </>
      )}
      {id === 'auto' && (
        <>
          <rect className="rp-picto-sheet" x="2.5" y="1.5" width="10" height="15" rx="1" />
          <rect className="rp-picto-sheet rp-picto-dashed" x="13.5" y="1.5" width="10" height="15" rx="1" />
        </>
      )}
    </svg>
  );
}

// ── Choix unique accessible : un seul arrêt de tabulation, flèches / Début / Fin pour changer ──
function Radios<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  testid,
  render,
  optionClass,
  dataKey,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
  className: string;
  testid?: string;
  render(o: { id: T; label: string }, active: boolean): ReactNode;
  optionClass(active: boolean): string;
  /** Attribut data-* posé sur chaque option (sélecteurs des tests). */
  dataKey?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.id === value));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const n = options.length;
    let i = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (current + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (current - 1 + n) % n;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(options[i].id);
    refs.current[i]?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} data-testid={testid}>
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === current ? 0 : -1}
            className={optionClass(active)}
            onClick={() => onChange(o.id)}
            {...(dataKey ? { [`data-${dataKey}`]: o.id } : {})}
          >
            {render(o, active)}
          </button>
        );
      })}
    </div>
  );
}

function Switch({ title, sub, on, onToggle, testid }: { title: string; sub: string; on: boolean; onToggle(): void; testid?: string }) {
  const id = useId();
  return (
    <div className="rp-switch-row">
      <span className="rp-switch-text">
        <span className="typo-switch-title" id={`${id}-t`}>
          {title}
        </span>
        <span className="typo-switch-sub" id={`${id}-s`}>
          {sub}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-s`}
        className={`typo-switch ${on ? 'on' : ''}`}
        onClick={onToggle}
        data-testid={testid}
      >
        <span />
      </button>
    </div>
  );
}

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

function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  summary?: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const bodyId = `rp-sec-${id}`;
  return (
    <section className={`rp-section ${open ? 'is-open' : ''}`} data-section={id}>
      <h3 className="rp-section-h">
        <button type="button" className="rp-section-btn" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="rp-section-title">{title}</span>
          {!open && summary && <span className="rp-section-summary">{summary}</span>}
          <ChevronDown size={14} className="rp-chevron" aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div className="rp-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function TypographyPopover({ anchor, onClose }: { anchor: DOMRect; onClose(): void }) {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const [ref, style] = useFloating(anchor, 'below');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [collapsed, setCollapsed] = useState<SectionId[]>(loadCollapsed);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || rootRef.current?.contains(t)) return;
      // Le bouton d'ouverture (actif) gère lui-même la bascule
      if (t.closest('.icon-btn.active')) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Échap ferme le panneau et rend le focus au bouton qui l'a ouvert (s'il l'avait).
      if (rootRef.current?.contains(document.activeElement) && opener?.isConnected) opener.focus();
      closeRef.current();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Rouvrir là où on s'était arrêté (défilement interne du panneau).
  useLayoutEffect(() => {
    const b = bodyRef.current;
    const y = Number(lsGet(LS_SCROLL) ?? 0);
    if (b && y > 0) b.scrollTop = y;
  }, []);
  // Focus au premier choix (la présentation choisie) : le clavier peut régler tout de suite.
  // (une fois placé : un élément encore masqué par useFloating ne prend pas le focus).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current || style.visibility === 'hidden') return;
    focusedRef.current = true;
    const q = (sel: string) => rootRef.current?.querySelector<HTMLElement>(sel);
    const el = q('.rp-body [role=radio][tabindex="0"]') ?? q('.rp-body button');
    el?.focus({ preventScroll: true });
  }, [style]);

  const d = readerDisplay(s);
  // Lecture résolue (display.ts) : défilement continu tant qu'aucune présentation n'est choisie.
  const set = (patch: Partial<Settings>) => update(patch);
  const toggle = (id: SectionId) =>
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      lsSet(LS_COLLAPSED, JSON.stringify(next));
      return next;
    });
  const isOpen = (id: SectionId) => !collapsed.includes(id);
  // Hauteur disponible sous le bouton : le panneau défile à l'intérieur (fenêtre de 900 px comprise).
  const maxHeight = Math.max(240, window.innerHeight - anchor.bottom - 8 - 12);
  const layout = LAYOUTS.find((l) => l.id === d.layout)!;
  const spread = SPREADS.find((x) => x.id === d.spread)!;
  const marksOn = d.marks !== 'off';

  return createPortal(
    <div
      ref={(el) => {
        rootRef.current = el;
        ref(el);
      }}
      className="floating typo-pop reader-panel"
      style={{ ...style, maxHeight }}
      role="dialog"
      aria-label="Mise en page et affichage"
      data-testid="reader-panel"
    >
      <div className="rp-head">
        <span className="rp-head-title">Mise en page et affichage</span>
        <button type="button" className="rp-close" onClick={() => closeRef.current()} aria-label="Fermer" title="Fermer (Échap)">
          <X size={14} />
        </button>
      </div>
      <div className="rp-body" ref={bodyRef} onScroll={(e) => lsSet(LS_SCROLL, String(Math.round(e.currentTarget.scrollTop)))}>
        <Section id="presentation" title="Présentation" summary={layout.label} open={isOpen('presentation')} onToggle={() => toggle('presentation')}>
          <Radios
            label="Présentation"
            value={d.layout}
            options={LAYOUTS}
            onChange={(v) => set({ readerLayout: v })}
            className="rp-tiles"
            testid="layout-choice"
            dataKey="layout"
            optionClass={(a) => `rp-tile ${a ? 'active' : ''}`}
            render={(o) => (
              <>
                <span className="rp-tile-picto">
                  <LayoutPicto id={o.id} />
                </span>
                <span className="rp-tile-label">{o.label}</span>
              </>
            )}
          />
          <p className="rp-hint" aria-live="polite">
            {layout.sub}
          </p>
          {d.layout === 'paged' && (
            <div className="rp-sub" data-testid="spread-block">
              <div className="typo-title">Pages à l’écran</div>
              <Radios
                label="Pages à l’écran"
                value={d.spread}
                options={SPREADS}
                onChange={(v) => set({ pagedSpread: v })}
                className="rp-spreads"
                testid="spread-choice"
                dataKey="spread"
                optionClass={(a) => `rp-spread ${a ? 'active' : ''}`}
                render={(o) => (
                  <>
                    <SpreadPicto id={o.id} />
                    <span>{o.label}</span>
                  </>
                )}
              />
              <p className="rp-hint">{spread.sub}</p>
            </div>
          )}
        </Section>

        <Section id="typo" title="Typographie" summary={`${s.fontFamily === 'serif' ? 'Serif' : 'Sans'} · ${s.fontSize} px`} open={isOpen('typo')} onToggle={() => toggle('typo')}>
          <div className="typo-section">
            <div className="typo-title">Police</div>
            <Radios
              label="Police"
              value={s.fontFamily}
              options={[
                { id: 'serif', label: 'Serif' },
                { id: 'sans', label: 'Sans' },
              ]}
              onChange={(v) => set({ fontFamily: v })}
              className="segmented typo-seg"
              dataKey="font"
              optionClass={(a) => (a ? 'active' : '')}
              render={(o) => o.label}
            />
          </div>
          <Slider id="typo-size" label="Taille" value={s.fontSize} min={14} max={28} step={1} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
          <Slider id="typo-lh" label="Interligne" value={s.lineHeight} min={1.4} max={2.0} step={0.05} format={(v) => v.toFixed(2).replace('.', ',')} onChange={(v) => set({ lineHeight: Math.round(v * 100) / 100 })} />
          <Slider id="typo-measure" label="Largeur du texte" value={s.measure} min={52} max={84} step={2} format={(v) => `${v} ch`} onChange={(v) => set({ measure: v })} />
          <Switch title="Connecteurs logiques" sub="Souligne donc, car, mais, or…" on={s.showConnectors} onToggle={() => set({ showConnectors: !s.showConnectors })} testid="connectors-switch" />
          <div
            className="typo-preview"
            style={{
              fontFamily: s.fontFamily === 'serif' ? 'var(--font-read)' : 'var(--font-ui)',
              fontSize: Math.min(s.fontSize, 16),
              lineHeight: s.lineHeight,
            }}
          >
            <div className="typo-preview-text">
              Je pense, <span className={s.showConnectors ? 'connector' : ''}>donc</span> je suis : cette vérité était si ferme que les suppositions des sceptiques ne pouvaient l’ébranler.
            </div>
          </div>
        </Section>

        <Section
          id="livre"
          title="Livre"
          summary={[d.bookLayout && 'Mise en page livre', d.paperLook && 'Papier'].filter(Boolean).join(' · ') || 'Désactivé'}
          open={isOpen('livre')}
          onToggle={() => toggle('livre')}
        >
          <Switch
            title="Mise en page livre"
            sub="Texte justifié et coupé, alinéas, titres composés comme à l’imprimé."
            on={d.bookLayout}
            onToggle={() => set({ bookLayout: !d.bookLayout })}
            testid="book-layout-switch"
          />
          <Switch title="Aspect papier" sub="Fond teinté et grain léger, comme une vraie page." on={d.paperLook} onToggle={() => set({ paperLook: !d.paperLook })} testid="paper-look-switch" />
        </Section>

        <Section
          id="pages"
          title="Numéros de page"
          summary={marksOn ? MARK_STYLES.find((m) => m.id === d.marks)?.label : 'Masqués'}
          open={isOpen('pages')}
          onToggle={() => toggle('pages')}
        >
          <Switch
            title="Afficher les numéros"
            sub={marksOn ? 'Dans la marge, là où commence chaque page' : 'Aucun repère dans le texte (« Aller à la page » reste possible)'}
            on={marksOn}
            onToggle={() => set({ pageMarks: marksOn ? 'off' : 'numbered' })}
            testid="page-marks-switch"
          />
          {marksOn && (
            <Radios
              label="Style des numéros de page"
              value={d.marks as Exclude<PageMarkStyle, 'off'>}
              options={MARK_STYLES}
              onChange={(v) => set({ pageMarks: v })}
              className="typo-choices rp-choices"
              testid="page-marks-mode"
              dataKey="mode"
              optionClass={(a) => `typo-choice ${a ? 'active' : ''}`}
              render={(o) => (
                <>
                  <span className={`typo-choice-icon pm-${o.id}`} aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <span className="typo-choice-label">{o.label}</span>
                </>
              )}
            />
          )}
          {d.layout === 'sheets' && <p className="rp-hint">En feuilles, chaque page porte aussi son folio en bas.</p>}
        </Section>

        <Section id="theme" title="Thème" summary={THEMES.find((t) => t.id === s.theme)?.label} open={isOpen('theme')} onToggle={() => toggle('theme')}>
          <Radios
            label="Thème"
            value={s.theme}
            options={THEMES}
            onChange={(v) => set({ theme: v })}
            className="segmented typo-seg rp-themes"
            dataKey="theme-id"
            optionClass={(a) => (a ? 'active' : '')}
            render={(o) => (
              <>
                <span className={`rp-swatch rp-swatch-${o.id}`} aria-hidden="true" />
                {o.label}
              </>
            )}
          />
        </Section>
      </div>
    </div>,
    document.body,
  );
}
