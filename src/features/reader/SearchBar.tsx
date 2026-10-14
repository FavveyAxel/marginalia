// Barre de recherche flottante du lecteur.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, List, Search, X } from 'lucide-react';
import type { EngineHandle, SearchHit } from './engine';
import './reader-tools.css';

export function SearchBar({ engine, onClose }: { engine: EngineHandle | null; onClose(): void }) {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      try {
        engineRef.current?.clearSearch();
      } catch {
        /* moteur démonté */
      }
    };
  }, []);

  // Recherche différée (250 ms)
  useEffect(() => {
    const q = query.trim();
    const n = ++seq.current;
    if (!q) {
      setHits([]);
      setIdx(0);
      setBusy(false);
      engineRef.current?.clearSearch();
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const eng = engineRef.current;
      if (!eng) {
        setBusy(false);
        return;
      }
      try {
        const res = await eng.search(q);
        if (n !== seq.current) return;
        setHits(res);
        setIdx(0);
        setListOpen(true);
        if (res.length) eng.goToSearchHit(res[0]);
        else eng.clearSearch();
      } catch (e) {
        console.error(e);
        if (n === seq.current) setHits([]);
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback(
    (i: number) => {
      if (!hits.length) return;
      const k = ((i % hits.length) + hits.length) % hits.length;
      setIdx(k);
      engineRef.current?.goToSearchHit(hits[k]);
    },
    [hits],
  );

  const close = () => {
    engineRef.current?.clearSearch();
    closeRef.current();
  };

  const q = query.trim();
  const noEngine = !engine;

  return (
    <div className="search-bar-wrap">
      <div
        className="floating search-bar"
        role="search"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="search-bar-row">
          <Search size={15} className="muted" />
          <input
            ref={inputRef}
            className="search-bar-input"
            placeholder="Rechercher dans le texte"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? idx - 1 : idx + 1);
              } else if (e.key === 'ArrowDown' && hits.length) {
                e.preventDefault();
                go(idx + 1);
              } else if (e.key === 'ArrowUp' && hits.length) {
                e.preventDefault();
                go(idx - 1);
              }
            }}
            aria-label="Rechercher dans le texte"
          />
          <span className="search-bar-count" aria-live="polite">
            {busy ? '…' : q && hits.length ? `${idx + 1} / ${hits.length}` : q ? (noEngine ? '' : '0 résultat') : ''}
          </span>
          <button className="icon-btn sm" onClick={() => go(idx - 1)} disabled={!hits.length} title="Précédent (Maj+Entrée)">
            <ChevronUp size={15} />
          </button>
          <button className="icon-btn sm" onClick={() => go(idx + 1)} disabled={!hits.length} title="Suivant (Entrée)">
            <ChevronDown size={15} />
          </button>
          <button className={`icon-btn sm ${listOpen && hits.length ? 'active' : ''}`} onClick={() => setListOpen((v) => !v)} disabled={!hits.length} title="Liste des résultats">
            <List size={14} />
          </button>
          <button className="icon-btn sm" onClick={close} title="Fermer (Échap)">
            <X size={14} />
          </button>
        </div>
        {noEngine && q && <div className="search-bar-note">Le texte n’est pas encore prêt pour la recherche.</div>}
        {listOpen && hits.length > 0 && (
          <div className="search-bar-list" role="listbox">
            {hits.slice(0, 200).map((h, i) => {
              const a = h.snippet.slice(0, h.matchStart);
              const m = h.snippet.slice(h.matchStart, h.matchStart + h.matchLength);
              const b = h.snippet.slice(h.matchStart + h.matchLength);
              return (
                <button key={h.id} role="option" aria-selected={i === idx} className={`search-bar-hit ${i === idx ? 'current' : ''}`} onClick={() => go(i)}>
                  <span className="search-bar-snippet">
                    {a}
                    <strong>{m}</strong>
                    {b}
                  </span>
                  <span className="search-bar-loc">{h.locationLabel}</span>
                </button>
              );
            })}
            {hits.length > 200 && <div className="search-bar-more">{hits.length - 200} autres résultats : affinez la recherche.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
