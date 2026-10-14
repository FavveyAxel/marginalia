// Sommaire : arborescence indentée, élément courant, progression.
import { useEffect, useMemo, useRef } from 'react';
import type { TocItem } from '../../lib/types';
import './reader-tools.css';

const clean = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();

export function TocPanel({
  items,
  currentLabel,
  progress,
  onSelect,
}: {
  items: TocItem[];
  currentLabel: string;
  progress: number;
  onSelect(item: TocItem): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const currentId = useMemo(() => {
    const cur = clean(currentLabel);
    if (!cur) return null;
    return items.find((i) => clean(i.label) === cur)?.id ?? null;
  }, [items, currentLabel]);

  useEffect(() => {
    if (!currentId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(currentId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  const frac = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress || 0));
  const pct = Math.round(frac * 100);

  return (
    <div className="toc-panel">
      <div className="toc-head">Sommaire</div>
      {items.length === 0 ? (
        <div className="toc-empty">
          <p>Ce document n’a pas de sommaire.</p>
          <span className="muted">Faites défiler le texte pour lire.</span>
        </div>
      ) : (
        <div className="toc-list" ref={listRef} role="tree">
          {items.map((it) => (
            <button
              key={it.id}
              data-toc={it.id}
              role="treeitem"
              aria-current={it.id === currentId ? 'location' : undefined}
              className={`toc-item ${it.id === currentId ? 'current' : ''} d${Math.min(it.depth, 4)}`}
              style={{ paddingLeft: 10 + Math.min(it.depth, 4) * 14 }}
              onClick={() => onSelect(it)}
              title={it.label}
            >
              <span className="toc-label">{it.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="toc-foot">
        <div className="toc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="toc-pct">{pct} %</span>
      </div>
    </div>
  );
}
