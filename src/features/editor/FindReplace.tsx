// Rechercher / remplacer flottant (⌘F, ⌘⇧H) + installation de la typographie française.
// S'appuie sur la recherche de SuperDoc (session de recherche : surlignage de toutes les occurrences
// par décorations ProseMirror, occurrence active, remplacement en une seule transaction = une étape d'annulation).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Replace, ReplaceAll, Search, WholeWord, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { DocEngine } from './engine';
import { attachTypography, setTypographyEnabled, subscribeTypography, typographyEnabled } from './typography';
import './find.css';
import { snapshotActiveDraft } from './versions';
import { fmtKeys, isMod, matchKeys } from '../../lib/keys';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const DIACRITICS: Record<string, string> = {
  a: 'aàâäáãå',
  c: 'cç',
  e: 'eéèêë',
  i: 'iîïíì',
  n: 'nñ',
  o: 'oôöóòõ',
  u: 'uùûüú',
  y: 'yÿý',
};
const ESC = /[.*+?^${}()|[\]\\]/g;

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  ignoreAccents: boolean;
}

/** Construit la requête SuperDoc : chaîne simple si possible, sinon expression régulière. */
export function buildQuery(q: string, o: FindOptions): string | RegExp {
  const needRegex = o.wholeWord || /[\s'’]/.test(q);
  if (!needRegex) return q;
  let src = '';
  for (const c of q) {
    if (/[\s  ]/.test(c)) {
      src += '[ \\u00A0\\u202F]+';
      continue;
    }
    if (c === "'" || c === '’') {
      src += "['’]";
      continue;
    }
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const cls = o.ignoreAccents ? DIACRITICS[base.toLowerCase()] : undefined;
    if (cls) {
      const set = o.caseSensitive ? (base === base.toLowerCase() ? cls : cls.toUpperCase()) : cls + cls.toUpperCase();
      src += `[${set}]`;
    } else src += c.replace(ESC, '\\$&');
  }
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, o.caseSensitive ? 'gu' : 'giu');
}

interface Session {
  count: number;
  index: number;
}

export function FindReplace({ engine: engineProp, ready }: { engine: () => DocEngine | null; ready: boolean }) {
  // `engine` est une nouvelle fonction à chaque rendu du parent : on la garde dans une ref pour garder des callbacks stables.
  const engineFn = useRef(engineProp);
  engineFn.current = engineProp;
  const engine = useCallback(() => engineFn.current(), []);
  const [open, setOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, ignoreAccents: false });
  const [res, setRes] = useState<Session>({ count: 0, index: -1 });
  const findRef = useRef<HTMLInputElement>(null);
  const replRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const internal = useRef(false); // modifications faites par la barre elle-même

  const editor = useCallback((): Any => {
    try {
      return (engine()?.debugEditor() as Any)?.editor ?? null;
    } catch {
      return null;
    }
  }, [engine]);

  // ── Typographie française : (ré)installée dès que l'éditeur existe ou est recréé ──
  useEffect(() => {
    if (!ready) return;
    const tick = () => attachTypography(editor());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [ready, editor]);

  // ── Session de recherche ──
  const run = useCallback(
    (q: string, o: FindOptions, scroll = true) => {
      const ed = editor();
      if (!ed) return;
      try {
        if (!q) {
          ed.commands.clearSearchSession();
          setRes({ count: 0, index: -1 });
          return;
        }
        const r = ed.commands.setSearchSession(buildQuery(q, o), { caseSensitive: o.caseSensitive, ignoreDiacritics: o.ignoreAccents });
        const matches: Any[] = r?.matches ?? [];
        setRes({ count: matches.length, index: matches.length ? 0 : -1 });
        if (scroll && matches[0]) ed.presentationEditor?.scrollToPosition?.(matches[0].from, { block: 'center', ifNeeded: true });
      } catch (e) {
        console.error(e);
        setRes({ count: 0, index: -1 });
      }
    },
    [editor],
  );

  useEffect(() => {
    if (open) run(query, opts);
  }, [open, query, opts, run]);

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    try {
      editor()?.commands.clearSearchSession();
    } catch {
      /* éditeur déjà détruit */
    }
    setRes({ count: 0, index: -1 });
    engine()?.focus();
  }, [editor, engine]);

  // Le document change pendant que la barre est ouverte : on recompte.
  useEffect(() => {
    if (!open) return;
    const ed = editor();
    if (!ed?.on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      if (internal.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => run(query, opts, false), 250);
    };
    ed.on('update', onUpdate);
    return () => {
      clearTimeout(timer);
      ed.off?.('update', onUpdate);
    };
  }, [open, editor, run, query, opts]);

  // Ferme à la fermeture de l'écrit.
  useEffect(
    () => () => {
      try {
        editor()?.commands.clearSearchSession();
      } catch {
        /* ignoré */
      }
    },
    [editor],
  );

  // ── Raccourcis ⌘F / ⌘⇧H (phase de capture, avant le raccourci de note de bas de page et la palette) ──
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!ready) return;
      const isFind = isMod(ev) && !ev.shiftKey && !ev.altKey && ev.code === 'KeyF';
      const isReplace = matchKeys(ev, '⌘⇧H'); // comme Word (Mac : ⌘⇧H ; Windows : Ctrl+H)
      if (isFind || isReplace) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const wantReplace = isReplace;
        const ed = editor();
        let sel = '';
        try {
          const { from, to, empty } = ed.state.selection;
          if (!empty && to - from <= 120) sel = ed.state.doc.textBetween(from, to, ' ');
        } catch {
          /* pas de sélection exploitable */
        }
        if (sel && !/\n/.test(sel)) setQuery(sel);
        if (wantReplace) setShowReplace(true);
        openRef.current = true;
        setOpen(true);
        setTimeout(() => {
          const el = wantReplace && openRef.current && findRef.current?.value ? replRef.current ?? findRef.current : findRef.current;
          el?.focus();
          findRef.current?.select();
        }, 0);
      } else if (ev.key === 'Escape' && openRef.current) {
        const t = ev.target as HTMLElement | null;
        if (barRef.current?.contains(t) || t?.closest?.('.ed-engine')) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          close();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, editor, close]);

  const refocus = (el: Element | null) => requestAnimationFrame(() => (el as HTMLElement | null)?.focus?.());

  const step = (dir: 1 | -1) => {
    const ed = editor();
    if (!ed || !res.count) return;
    const keep = document.activeElement;
    try {
      const r = ed.commands[dir === 1 ? 'nextSearchMatch' : 'previousSearchMatch']();
      if (typeof r?.activeMatchIndex === 'number') setRes((s) => ({ ...s, index: r.activeMatchIndex }));
    } catch (e) {
      console.error(e);
    }
    refocus(keep && barRef.current?.contains(keep) ? keep : findRef.current);
  };

  const replaceOne = () => {
    const ed = editor();
    if (!ed || !res.count) return;
    const keep = document.activeElement;
    internal.current = true;
    try {
      const r = ed.commands.replaceSearchMatch(replacement);
      const n: number = r?.matches?.length ?? 0;
      setRes({ count: n, index: n ? (r?.activeMatchIndex ?? 0) : -1 });
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => (internal.current = false), 400);
    }
    refocus(keep && barRef.current?.contains(keep) ? keep : findRef.current);
  };

  const replaceAll = async () => {
    if (!editor() || !res.count) return;
    await snapshotActiveDraft('replace'); // version de sécurité avant un remplacement en masse
    const ed = editor();
    if (!ed) return;
    internal.current = true;
    let n = 0;
    try {
      n = ed.commands.replaceAllSearchMatches(replacement)?.replacedCount ?? 0;
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => (internal.current = false), 400);
    }
    run(query, opts, false);
    useStore.getState().toast(n === 1 ? '1 occurrence remplacée' : `${n} occurrences remplacées`, 'info');
    refocus(findRef.current);
  };

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };
  const onReplKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey || e.metaKey || e.ctrlKey) replaceAll();
      else replaceOne();
    }
  };

  const toggle = (k: keyof FindOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const counter = !query ? '' : res.count ? `${res.index + 1} sur ${res.count}` : 'Aucun résultat';

  if (!open) return null;
  return (
    <div ref={barRef} className="ed-find anim-scale" role="search" aria-label="Rechercher dans le document" data-find="bar">
      <button
        className={`ed-find-chev ${showReplace ? 'open' : ''}`}
        onClick={() => setShowReplace((v) => !v)}
        title={fmtKeys("Afficher / masquer le remplacement (⌘⇧H)")}
        aria-label="Afficher le remplacement"
        aria-expanded={showReplace}
        data-find="toggle-replace"
      >
        <ChevronDown size={14} />
      </button>
      <div className="ed-find-rows">
        <div className="ed-find-row">
          <div className={`ed-find-field ${query && !res.count ? 'none' : ''}`}>
            <Search size={13} className="ed-find-ico" aria-hidden />
            <input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFindKey}
              placeholder="Rechercher"
              aria-label="Rechercher"
              spellCheck={false}
              autoFocus
              data-find="query"
            />
            <button className={`ed-find-opt ${opts.caseSensitive ? 'on' : ''}`} onClick={() => toggle('caseSensitive')} title="Respecter la casse" aria-label="Respecter la casse" aria-pressed={opts.caseSensitive} data-find="case">
              <CaseSensitive size={15} />
            </button>
            <button className={`ed-find-opt ${opts.wholeWord ? 'on' : ''}`} onClick={() => toggle('wholeWord')} title="Mot entier" aria-label="Mot entier" aria-pressed={opts.wholeWord} data-find="word">
              <WholeWord size={15} />
            </button>
            <button className={`ed-find-opt ed-find-acc ${opts.ignoreAccents ? 'on' : ''}`} onClick={() => toggle('ignoreAccents')} title="Ignorer les accents" aria-label="Ignorer les accents" aria-pressed={opts.ignoreAccents} data-find="accents">
              é=e
            </button>
          </div>
          <span className="ed-find-count" aria-live="polite" data-find="count">
            {counter}
          </span>
          <button className="ed-find-btn" onClick={() => step(-1)} disabled={!res.count} title={fmtKeys("Occurrence précédente (⇧↵)")} aria-label="Occurrence précédente" data-find="prev">
            <ChevronUp size={15} />
          </button>
          <button className="ed-find-btn" onClick={() => step(1)} disabled={!res.count} title="Occurrence suivante (↵)" aria-label="Occurrence suivante" data-find="next">
            <ChevronDown size={15} />
          </button>
          <button className="ed-find-btn" onClick={close} title="Fermer (Échap)" aria-label="Fermer la recherche" data-find="close">
            <X size={15} />
          </button>
        </div>
        {showReplace && (
          <div className="ed-find-row">
            <div className="ed-find-field">
              <Replace size={13} className="ed-find-ico" aria-hidden />
              <input ref={replRef} value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={onReplKey} placeholder="Remplacer par" aria-label="Remplacer par" spellCheck={false} data-find="replacement" />
            </div>
            <button className="ed-find-txt" onClick={replaceOne} disabled={!res.count} title="Remplacer cette occurrence (↵)" data-find="replace">
              Remplacer
            </button>
            <button className="ed-find-txt" onClick={replaceAll} disabled={!res.count} title="Tout remplacer (une seule étape d’annulation)" data-find="replace-all">
              <ReplaceAll size={14} /> Tout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Interrupteur « Typographie française » (barre d'outils). */
export function useTypography(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeTypography, typographyEnabled, typographyEnabled);
  return [on, setTypographyEnabled];
}
