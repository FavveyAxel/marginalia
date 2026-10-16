// « Reproduire la mise en forme » (le pinceau de Word).
//   Bouton : un clic copie la mise en forme de la sélection (ou du curseur) ; la sélection suivante à la
//   souris la reçoit, puis le mode s'arrête. Double-clic : le pinceau reste actif jusqu'à Échap ou un
//   nouveau clic sur le bouton.
//   ⌥⌘C copie, ⌥⌘V applique à la sélection (au mot sous le curseur sans sélection) — Ctrl+Maj+C / V
//   sous Windows (lib/keys : ⌘⌥ → Ctrl+Maj, à cause d'AltGr). Touches lues sur event.code : sur Mac,
//   ⌥ change event.key (ç, ◊).
// Copie et application : engine.copyFormat / applyFormat (une seule étape d'annulation).
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { CopiedFormat, DocEngine } from './engine';
import { fmtKeys, isMac, matchKeys } from '../../lib/keys';
import { FORMAT_PAINTER_EVENT, type PainterRequest } from './painterEvents';

export type PainterMode = null | 'once' | 'sticky';

export interface PainterCtl {
  mode: PainterMode;
  /** Bouton de la barre : `detail` = nombre de clics (2 : pinceau maintenu). */
  onButton: (detail: number) => void;
  /** Le pinceau est armé (le glisser-déposer du texte s'efface alors devant lui). */
  activeRef: MutableRefObject<boolean>;
}

/** Cible clavier dans le texte du document. */
function inDocument(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('.ProseMirror');
}

export function useFormatPainter({
  engineRef,
  hostRef,
  enabled,
  notify,
  refresh,
}: {
  engineRef: MutableRefObject<DocEngine | null>;
  hostRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  notify: (message: string, tone?: 'info' | 'error' | 'success') => void;
  refresh: () => void;
}): PainterCtl {
  const [mode, setModeState] = useState<PainterMode>(null);
  const modeRef = useRef<PainterMode>(null);
  const activeRef = useRef(false);
  const stored = useRef<CopiedFormat | null>(null);
  const setMode = useCallback((m: PainterMode) => {
    modeRef.current = m;
    activeRef.current = m !== null;
    setModeState(m);
  }, []);

  const copy = useCallback((): boolean => {
    const e = engineRef.current;
    const f = e?.copyFormat() ?? null;
    if (!f) return false;
    stored.current = f;
    return true;
  }, [engineRef]);

  const paste = useCallback((): boolean => {
    const e = engineRef.current;
    if (!e) return false;
    if (!stored.current) {
      notify(fmtKeys('Copiez d’abord une mise en forme (⌥⌘C ou le pinceau).'), 'info');
      return false;
    }
    const ok = e.applyFormat(stored.current);
    refresh();
    return ok;
  }, [engineRef, notify, refresh]);

  const onButton = useCallback(
    (detail: number) => {
      if (!enabled) return;
      if (detail >= 2) {
        // 2e clic d'un double-clic : le 1er a déjà copié et armé le pinceau
        if (stored.current || copy()) setMode('sticky');
        return;
      }
      if (modeRef.current) {
        setMode(null);
        return;
      }
      if (copy()) setMode('once');
    },
    [enabled, copy, setMode],
  );

  useEffect(() => {
    if (!enabled && modeRef.current) setMode(null);
  }, [enabled, setMode]);

  // Raccourcis : ⌥⌘C / ⌥⌘V ; Échap désarme le pinceau. Phase de capture : avant le ProseMirror de
  // SuperDoc (dont ⌘⌥C efface toute la mise en forme, style de paragraphe compris).
  useEffect(() => {
    if (!enabled) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && modeRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
        setMode(null);
        return;
      }
      if (!inDocument(ev.target)) return;
      if (matchKeys(ev, '⌥⌘C')) {
        ev.preventDefault();
        ev.stopPropagation();
        if (copy()) notify('Mise en forme copiée', 'info');
      } else if (matchKeys(ev, '⌥⌘V')) {
        ev.preventDefault();
        ev.stopPropagation();
        paste();
      } else if (!isMac && ev.ctrlKey && ev.altKey && !ev.shiftKey && ev.code === 'KeyC') {
        // Windows : Ctrl+Alt+C (= AltGr+C) n'atteint pas le « tout effacer » de SuperDoc ; le caractère
        // AltGr éventuel s'écrit normalement (pas de preventDefault).
        ev.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, copy, paste, notify, setMode]);

  // Palette de commandes
  useEffect(() => {
    if (!enabled) return;
    const on = (ev: Event) => {
      const what = (ev as CustomEvent<PainterRequest>).detail;
      if (what === 'copy') {
        if (copy()) notify('Mise en forme copiée', 'info');
        else notify('Placez le curseur dans le texte dont vous voulez copier la mise en forme.', 'info');
      } else if (what === 'paste') paste();
      engineRef.current?.focus();
    };
    window.addEventListener(FORMAT_PAINTER_EVENT, on);
    return () => window.removeEventListener(FORMAT_PAINTER_EVENT, on);
  }, [enabled, copy, paste, notify, engineRef]);

  // Pinceau armé : la sélection faite à la souris dans le document reçoit la mise en forme au relâchement.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mode) return;
    let pending = false;
    const down = (ev: PointerEvent) => {
      if (ev.button === 0 && (ev.target as HTMLElement).closest?.('.superdoc-page')) pending = true;
    };
    const up = () => {
      if (!pending) return;
      pending = false;
      // après la mise à jour de la sélection par SuperDoc (au relâchement)
      setTimeout(() => {
        if (!modeRef.current) return;
        paste();
        if (modeRef.current === 'once') setMode(null);
      }, 0);
    };
    host.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up);
    return () => {
      host.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up);
    };
  }, [mode, hostRef, paste, setMode]);

  return { mode, onButton, activeRef };
}
