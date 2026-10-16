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

type Action = 'copy' | 'paste' | 'brush';

export function useFormatPainter({
  engineRef,
  hostRef,
  enabled,
  busy = false,
  notify,
  refresh,
}: {
  engineRef: MutableRefObject<DocEngine | null>;
  hostRef: RefObject<HTMLElement | null>;
  /** Document modifiable (lecture seule : pinceau inactif, raccourcis laissés passer). */
  enabled: boolean;
  /** Mise en page en cours (réglage de page, modification de style, restauration) : les raccourcis et commandes
   *  restent interceptés — sinon ⌥⌘C atteindrait le « tout effacer » de SuperDoc, Ctrl+Maj+V le collage sans
   *  mise en forme — et sont exécutés dès la fin de la mise en page. */
  busy?: boolean;
  notify: (message: string, tone?: 'info' | 'error' | 'success') => void;
  refresh: () => void;
}): PainterCtl {
  const [mode, setModeState] = useState<PainterMode>(null);
  const modeRef = useRef<PainterMode>(null);
  const activeRef = useRef(false);
  const stored = useRef<CopiedFormat | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /** Actions reçues pendant la mise en page, exécutées dans l'ordre à sa fin. */
  const queue = useRef<Action[]>([]);
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

  const copyNotify = useCallback(
    (fromMenu: boolean) => {
      if (copy()) notify('Mise en forme copiée', 'info');
      else if (fromMenu) notify('Placez le curseur dans le texte dont vous voulez copier la mise en forme.', 'info');
    },
    [copy, notify],
  );

  /** Pinceau armé : la sélection que l'on vient de faire (souris relâchée) reçoit la mise en forme. */
  const brush = useCallback(() => {
    if (!modeRef.current) return;
    paste();
    if (modeRef.current === 'once') setMode(null);
  }, [paste, setMode]);

  const run = useCallback(
    (a: Action) => {
      if (a === 'copy') copyNotify(true);
      else if (a === 'paste') paste();
      else brush();
    },
    [copyNotify, paste, brush],
  );
  /** Tout de suite, ou à la fin de la mise en page en cours (une seule fois chacune). */
  const request = useCallback(
    (a: Action) => {
      if (!busyRef.current) {
        run(a);
        return;
      }
      if (a === 'copy' || a === 'brush') queue.current = queue.current.filter((x) => x !== a);
      queue.current.push(a);
    },
    [run],
  );
  useEffect(() => {
    if (busy || !enabled || !queue.current.length) return;
    // après le rendu qui suit la mise en page (sélection et positions de nouveau valides)
    const t = setTimeout(() => {
      const q = queue.current.splice(0);
      for (const a of q) run(a);
      if (q.length) engineRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [busy, enabled, run, engineRef]);

  const onButton = useCallback(
    (detail: number) => {
      if (!enabled) return;
      if (detail >= 2) {
        // 2e clic d'un double-clic : le 1er a copié la sélection et armé le pinceau (s'il l'avait désarmé :
        // nouvelle copie, jamais une mise en forme ancienne)
        if (modeRef.current === 'once' ? stored.current : copy()) setMode('sticky');
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
    if (!enabled) queue.current = [];
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
        if (busyRef.current) request('copy');
        else copyNotify(false);
      } else if (matchKeys(ev, '⌥⌘V')) {
        ev.preventDefault();
        ev.stopPropagation();
        request('paste');
      } else if (!isMac && ev.ctrlKey && ev.altKey && !ev.shiftKey && ev.code === 'KeyC') {
        // Windows : Ctrl+Alt+C (= AltGr+C) n'atteint pas le « tout effacer » de SuperDoc ; le caractère
        // AltGr éventuel s'écrit normalement (pas de preventDefault).
        ev.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, copyNotify, request, setMode]);

  // Palette de commandes
  useEffect(() => {
    if (!enabled) return;
    const on = (ev: Event) => {
      const what = (ev as CustomEvent<PainterRequest>).detail;
      if (what === 'copy' || what === 'paste') request(what);
      if (!busyRef.current) engineRef.current?.focus();
    };
    window.addEventListener(FORMAT_PAINTER_EVENT, on);
    return () => window.removeEventListener(FORMAT_PAINTER_EVENT, on);
  }, [enabled, request, engineRef]);

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
      setTimeout(() => request('brush'), 0);
    };
    host.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up);
    return () => {
      host.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up);
    };
  }, [mode, hostRef, request]);

  return { mode, onButton, activeRef };
}
