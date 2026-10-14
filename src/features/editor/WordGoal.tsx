// Objectif de mots, compteurs et barre de progression discrète (bas de l'éditeur).
// Réutilise les statistiques du moteur (EngineStats) : aucun comptage concurrent.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Target } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Draft } from '../../lib/types';
import type { DocEngine, EngineState, EngineStats } from './engine';
import { countWords } from './docx';
import { fmtInt } from './save';
import './style-review.css';
import { Popover, usePop } from './Popover';

const PRESETS = [500, 1000, 1500, 2000, 3000];
const WPM = 230;

export function readingTime(words: number): string {
  const m = words / WPM;
  if (words === 0) return '0 min';
  if (m < 1) return '< 1 min';
  return `${Math.round(m)} min`;
}

/** Mots de la sélection courante (0 si le curseur est simple). */
function selectionWords(engine: DocEngine | null): number {
  try {
    const ed = (engine?.debugEditor() as { editor?: { state: { selection: { empty: boolean; from: number; to: number }; doc: { textBetween(a: number, b: number, s: string, l: string): string } } } } | undefined)?.editor;
    if (!ed || ed.state.selection.empty) return 0;
    const { from, to } = ed.state.selection;
    return countWords(ed.state.doc.textBetween(from, to, ' ', ' '));
  } catch {
    return 0;
  }
}

export function WordGoal({ draft, stats, fmt, engine, editable }: { draft: Draft; stats: EngineStats; fmt: EngineState; engine: () => DocEngine | null; editable: boolean }) {
  const patch = useStore((s) => s.patch);
  const pop = usePop();
  const goal = draft.wordGoal && draft.wordGoal > 0 ? draft.wordGoal : 0;
  const [input, setInput] = useState(goal ? String(goal) : '');
  const [celebrate, setCelebrate] = useState(0);
  const prevReached = useRef<boolean | null>(null);

  const selWords = useMemo(() => selectionWords(engine()), [fmt, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = goal ? Math.min(100, (stats.words / goal) * 100) : 0;
  const reached = goal > 0 && stats.words >= goal;

  // Animation sobre quand l'objectif est franchi (pas à l'ouverture d'un écrit déjà au-dessus).
  useEffect(() => {
    if (prevReached.current === false && reached) setCelebrate((n) => n + 1);
    prevReached.current = goal ? reached : null;
  }, [reached, goal]);
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(0), 2400);
    return () => clearTimeout(t);
  }, [celebrate]);

  useEffect(() => {
    if (!pop.isOpen) setInput(goal ? String(goal) : '');
  }, [goal, pop.isOpen]);

  const setGoal = (n: number | null) => {
    const v = n && n > 0 ? Math.min(1_000_000, Math.round(n)) : undefined;
    // Un nouvel objectif déjà atteint ne déclenche pas la célébration.
    prevReached.current = v ? stats.words >= v : null;
    patch('drafts', draft.id, { wordGoal: v });
    setInput(v ? String(v) : '');
  };
  const commit = () => {
    const raw = input.trim();
    if (!raw) return setGoal(null);
    const n = Number(raw.replace(/\s/g, ''));
    if (Number.isFinite(n) && n > 0) setGoal(n);
    else setInput(goal ? String(goal) : '');
  };

  const label = goal ? `${fmtInt(stats.words)} / ${fmtInt(goal)}` : null;

  return (
    <>
      {goal > 0 && (
        <div
          className={`wg-track ${reached ? 'done' : ''}`}
          role="progressbar"
          aria-label="Progression vers l’objectif de mots"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(stats.words, goal)}
          data-pct={Math.round(pct)}
        >
          <div className="wg-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="wg-group">
        {selWords > 0 && (
          <span className="wg-sel anim-fade" data-testid="wg-sel">
            {fmtInt(selWords)} mot{selWords > 1 ? 's' : ''} sélectionné{selWords > 1 ? 's' : ''}
          </span>
        )}
        <button
          key={celebrate}
          className={`wg-pill ${pop.isOpen ? 'open' : ''} ${reached ? 'done' : ''} ${celebrate ? 'celebrate' : ''}`}
          onClick={(e) => pop.toggle(e.currentTarget)}
          aria-label={goal ? `Objectif : ${stats.words} mots sur ${goal}` : 'Définir un objectif de mots'}
          title={goal ? (reached ? 'Objectif atteint' : `Encore ${fmtInt(goal - stats.words)} mots`) : 'Définir un objectif de mots'}
          data-goal={goal || undefined}
        >
          {reached ? <Check size={13} className="wg-check" /> : <Target size={13} />}
          {label ? (
            <span className="wg-label">
              {label} <span className="wg-unit">mots</span>
            </span>
          ) : (
            <span className="wg-label">Objectif</span>
          )}
          {goal > 0 && <span className="wg-pct">{Math.round(pct)} %</span>}
        </button>
      </div>
      <Popover pop={pop} prefer="above" label="Objectif de mots" className="ed-stats wg-pop">
        <div className="wg-pop-title">Objectif de mots</div>
        <div className="wg-field">
          <input
            className="input wg-input"
            inputMode="numeric"
            placeholder="ex. 2 000"
            value={input}
            disabled={!editable}
            onChange={(e) => setInput(e.target.value.replace(/[^\d\s]/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Nombre de mots visé"
          />
          <span className="wg-unit">mots</span>
        </div>
        <div className="wg-presets">
          {PRESETS.map((n) => (
            <button key={n} className={`chip ${goal === n ? 'active' : ''}`} onClick={() => setGoal(n)}>
              {fmtInt(n)}
            </button>
          ))}
        </div>
        {goal > 0 && (
          <button className="btn btn-sm btn-ghost wg-clear" onClick={() => setGoal(null)}>
            Retirer l’objectif
          </button>
        )}
        <dl className="wg-dl">
          <dt>Mots</dt>
          <dd>{fmtInt(stats.words)}</dd>
          <dt>Caractères</dt>
          <dd>{fmtInt(stats.chars)}</dd>
          <dt>Sans espaces</dt>
          <dd>{fmtInt(stats.charsNoSpaces)}</dd>
          <dt>Temps de lecture</dt>
          <dd>{readingTime(stats.words)}</dd>
          {selWords > 0 && (
            <>
              <dt>Sélection</dt>
              <dd>{fmtInt(selWords)} mots</dd>
            </>
          )}
        </dl>
      </Popover>
    </>
  );
}
