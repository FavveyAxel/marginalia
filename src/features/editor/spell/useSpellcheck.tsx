// Branchement du correcteur dans l'éditeur : interrupteur, menu contextuel des fautes.
// Le soulignement est peint par SuperDoc (pipeline « proofing ») sur les pages rendues ;
// la vérification est incrémentale (paragraphes modifiés, délai de 400 ms) côté SuperDoc,
// le travail (dictionnaire, vérification, suggestions) se fait dans un Web Worker.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BookPlus, EyeOff, SpellCheck } from 'lucide-react';
import type { DocEngine } from '../engine';
import { Popover, type usePop } from '../Popover';
import { readSpellEnabled, spellClient, spellProofingConfig, writeSpellEnabled } from './client';
import './spell.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface MenuState {
  rect: DOMRect;
  word: string;
  from: number;
  to: number;
  suggestions: string[] | null;
}

export interface Spellcheck {
  enabled: boolean;
  toggle: () => void;
  /** 'checking' pendant le chargement du dictionnaire et les vérifications. */
  status: string;
  menu: MenuState | null;
  closeMenu: () => void;
  apply: (s: string) => void;
  ignore: () => void;
  addToDictionary: () => void;
}

export function useSpellcheck(engine: () => DocEngine | null, ready: boolean, editable: boolean): Spellcheck {
  const [enabled, setEnabled] = useState(readSpellEnabled);
  const [status, setStatus] = useState('idle');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const engineFn = useRef(engine);
  engineFn.current = engine;

  const pres = (): Any => engineFn.current()?.presentation() ?? null;

  // Active / coupe le correcteur du moteur.
  useEffect(() => {
    if (!ready) return;
    const e = engineFn.current();
    if (!e) return;
    e.setProofing(enabled ? spellProofingConfig(setStatus) : null);
    if (!enabled) {
      setStatus('disabled');
      return;
    }
    const c = spellClient();
    c.retain();
    return () => c.release();
  }, [ready, enabled]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      writeSpellEnabled(!v);
      return !v;
    });
    setMenu(null);
  }, []);

  // Clic droit sur un mot souligné : menu de suggestions.
  useEffect(() => {
    if (!ready || !enabled) return;
    const onCtx = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (!t || typeof t.closest !== 'function' || !t.closest('.ed-engine')) return;
      const p = pres();
      const mgr = p?.proofingManager;
      if (!mgr?.isEnabled) return;
      let hit: Any = null;
      try {
        hit = p.hitTest(ev.clientX, ev.clientY);
      } catch {
        hit = null;
      }
      const pos = hit?.pos;
      if (typeof pos !== 'number') return;
      const issue = mgr.getIssueAtPosition(pos) ?? (pos > 0 ? mgr.getIssueAtPosition(pos - 1) : null);
      if (!issue) return;
      ev.preventDefault();
      ev.stopPropagation();
      const word: string = issue.word ?? issue.message ?? '';
      const el = t.closest('.sd-proofing-spelling');
      const rect = el ? el.getBoundingClientRect() : new DOMRect(ev.clientX, ev.clientY, 1, 1);
      setMenu({ rect, word, from: issue.pmFrom, to: issue.pmTo, suggestions: null });
      spellClient()
        .suggest(word, 5)
        .then((s) => setMenu((m) => (m && m.word === word && m.from === issue.pmFrom ? { ...m, suggestions: s } : m)))
        .catch(() => setMenu((m) => (m && m.word === word ? { ...m, suggestions: [] } : m)));
    };
    document.addEventListener('contextmenu', onCtx, true);
    const scroller = document.querySelector('.ed-scroll');
    const close = () => setMenu(null);
    scroller?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('contextmenu', onCtx, true);
      scroller?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [ready, enabled]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const apply = useCallback(
    (s: string) => {
      const m = menuRef.current;
      setMenu(null);
      const p = pres();
      const ed = p?.editor;
      if (!m || !ed || !editable) return;
      const { state } = ed;
      let { from, to } = m;
      // positions périmées (saisie entre-temps) : on retrouve le mot dans son paragraphe
      if (to > state.doc.content.size || state.doc.textBetween(from, to) !== m.word) {
        const $p = state.doc.resolve(Math.min(from, state.doc.content.size));
        const start = $p.start();
        const txt = state.doc.textBetween(start, $p.end(), '\0', '\0');
        const i = txt.indexOf(m.word);
        if (i < 0) return;
        from = start + i;
        to = from + m.word.length;
        if (state.doc.textBetween(from, to) !== m.word) return;
      }
      ed.view.dispatch(state.tr.insertText(s, from, to));
      ed.view.focus();
    },
    [editable],
  );

  const ignore = useCallback(() => {
    const m = menuRef.current;
    setMenu(null);
    if (!m) return;
    spellClient().ignored.add(m.word);
    pres()?.proofingManager?.ignoreWord(m.word);
    pres()?.editor?.view?.focus();
  }, []);

  const addToDictionary = useCallback(() => {
    const m = menuRef.current;
    setMenu(null);
    if (!m) return;
    spellClient().addToDictionary(m.word);
    // effacement immédiat ; le worker ne le signalera plus
    pres()?.proofingManager?.ignoreWord(m.word);
    pres()?.editor?.view?.focus();
  }, []);

  // Accès de test (développement uniquement)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __spell?: unknown };
    w.__spell = { client: spellClient(), enabled, status };
  }, [enabled, status]);

  return { enabled, toggle, status, menu, closeMenu, apply, ignore, addToDictionary };
}

/** Interrupteur « Vérifier l'orthographe » (barre du haut de l'éditeur). */
export function SpellToggle({ spell, disabled }: { spell: Spellcheck; disabled?: boolean }) {
  const loading = spell.enabled && spell.status === 'checking';
  return (
    <button
      className={`icon-btn ed-spell-toggle ${spell.enabled ? 'active' : ''} ${loading ? 'busy' : ''}`}
      onClick={spell.toggle}
      disabled={disabled}
      title={spell.enabled ? 'Vérifier l’orthographe : activé' : 'Vérifier l’orthographe : désactivé'}
      aria-label="Vérifier l’orthographe"
      aria-pressed={spell.enabled}
      data-spell-toggle
    >
      <SpellCheck size={16} />
    </button>
  );
}

/** Menu des suggestions pour le mot souligné. */
export function SpellMenu({ spell }: { spell: Spellcheck }) {
  const m = spell.menu;
  const pop = useMemo<ReturnType<typeof usePop>>(
    () => ({
      anchor: m?.rect ?? null,
      anchorEl: null,
      isOpen: !!m,
      toggle: () => spell.closeMenu(),
      open: () => undefined,
      close: spell.closeMenu,
    }),
    [m, spell.closeMenu],
  );
  const listRef = useRef<HTMLDivElement>(null);
  // focus sur le premier choix dès que le menu est complet
  useEffect(() => {
    if (!m || m.suggestions === null) return;
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [m]);
  if (!m) return null;
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };
  return (
    <Popover pop={pop} label="Orthographe" className="ed-menu ed-spell-menu">
      <div ref={listRef} role="menu" aria-label={`Suggestions pour « ${m.word} »`} onKeyDown={onKey}>
        <div className="ed-pop-title ed-spell-word">« {m.word} »</div>
        {m.suggestions === null ? (
          <div className="ed-spell-note">Recherche de suggestions…</div>
        ) : m.suggestions.length === 0 ? (
          <div className="ed-spell-note">Aucune suggestion</div>
        ) : (
          m.suggestions.map((s) => (
            <button key={s} role="menuitem" className="menu-item ed-spell-sugg" onClick={() => spell.apply(s)} data-spell-sugg={s}>
              {s}
            </button>
          ))
        )}
        <div className="divider" />
        <button role="menuitem" className="menu-item" onClick={spell.ignore} data-spell-action="ignore">
          <EyeOff size={14} /> Ignorer
        </button>
        <button role="menuitem" className="menu-item" onClick={spell.addToDictionary} data-spell-action="add">
          <BookPlus size={14} /> Ajouter au dictionnaire
        </button>
      </div>
    </Popover>
  );
}
