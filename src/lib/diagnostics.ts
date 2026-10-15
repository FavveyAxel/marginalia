// ─────────────────────────────────────────────────────────────
// Diagnostic local du redimensionnement de la fenêtre.
// Garde en mémoire les derniers gestes (clics, sélection, touches, navigation, tâches longues)
// et les écrit dans le journal local de l'app (diagnostic.log) quand la taille de la fenêtre
// change ou que l'interface se fige. Rien ne quitte le Mac.
// ─────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { host } from './platform';
import { useStore } from './store';

type Ev = [number, string, unknown?];
const ring: Ev[] = [];
const push = (kind: string, data?: unknown) => {
  ring.push([Math.round(performance.now()), kind, data]);
  if (ring.length > 40) ring.shift();
};

function describe(t: EventTarget | null): string {
  let el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
  const parts: string[] = [];
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    parts.push(el.tagName.toLowerCase() + (cls ? '.' + cls : ''));
  }
  return parts.join(' < ');
}

function snapshot() {
  const vv = window.visualViewport;
  const sel = document.getSelection();
  return {
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    screen: [window.screenX, window.screenY],
    dpr: window.devicePixelRatio,
    visual: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), scale: vv.scale } : null,
    route: useStore.getState().route.name,
    selection: sel ? sel.toString().length : 0,
    fullscreen: !!document.fullscreenElement,
  };
}

export function useResizeDiagnostics() {
  useEffect(() => {
    if (!host.diag) return;
    const log = (what: string, extra?: unknown) => void host.diag!(what, snapshot(), extra ?? null, ring.slice());
    let last = [window.outerWidth, window.outerHeight];
    log('interface-demarree');
    const onResize = () => {
      const now = [window.outerWidth, window.outerHeight];
      if (now[0] === last[0] && now[1] === last[1]) return;
      log('taille-changee', { avant: last, apres: now });
      last = now;
    };
    const onDown = (e: MouseEvent) => push('mousedown', { t: describe(e.target), b: e.button, n: e.detail, x: e.clientX, y: e.clientY });
    const onUp = (e: MouseEvent) => push('mouseup', { t: describe(e.target), n: e.detail });
    const onDbl = (e: MouseEvent) => push('dblclick', describe(e.target));
    const onKey = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey || e.altKey) && push('key', `${e.metaKey ? '⌘' : ''}${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.code}`);
    let selT = 0;
    const onSel = () => {
      const now = performance.now();
      if (now - selT < 300) return;
      selT = now;
      push('selection', document.getSelection()?.toString().length ?? 0);
    };
    const onFs = () => log('plein-ecran', !!document.fullscreenElement);
    const unsub = useStore.subscribe((s, p) => s.route !== p.route && push('route', s.route.name));
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          push('tache-longue', Math.round(e.duration));
          if (e.duration > 400) log('interface-figee', Math.round(e.duration));
        }
      });
      obs.observe({ type: 'longtask', buffered: false });
    } catch {
      obs = null;
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('dblclick', onDbl, true);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('dblclick', onDbl, true);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('fullscreenchange', onFs);
      unsub();
      obs?.disconnect();
    };
  }, []);
}

/**
 * Erreurs JavaScript non rattrapées du rendu (window.onerror, promesses rejetées) : consignées dans
 * le journal local, au plus 20 par minute et sans répéter la même erreur plus d'une fois par 30 s.
 */
export function installErrorReporting() {
  if (!host.diag || (window as unknown as { __mgErrors?: boolean }).__mgErrors) return;
  (window as unknown as { __mgErrors?: boolean }).__mgErrors = true;
  const recent = new Map<string, number>();
  let windowStart = 0;
  let count = 0;
  const report = (kind: string, message: string, stack?: string) => {
    if (/ResizeObserver loop/.test(message)) return; // bruit bénin de Chromium
    const now = Date.now();
    const key = kind + message;
    if (now - (recent.get(key) ?? -Infinity) < 30_000) return;
    recent.set(key, now);
    if (recent.size > 200) recent.clear();
    if (now - windowStart > 60_000) {
      windowStart = now;
      count = 0;
    }
    if (++count > 20) return;
    void host.diag!(kind, message.slice(0, 2000), (stack ?? '').slice(0, 4000), { route: useStore.getState().route.name }).catch(() => undefined);
  };
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    report('erreur-js', String(e.message || err?.message || 'erreur'), err?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    report('promesse-rejetee', String(r?.message ?? r), r?.stack);
  });
}
