// 11. Menu de classement d'un passage déposé sur la carte (ou « Sur la carte » depuis la barre de
// sélection) : Surlignage par défaut (Entrée, H), ou une catégorie (1–6). Crée l'extrait dans le livre
// puis la carte, à l'endroit du dépôt.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Highlighter } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import { CATEGORIES, PLAIN_DEF, catColor } from '../../../../lib/categories';
import type { CategoryId } from '../../../../lib/types';
import { Kbd } from '../../../../components/ui';
import { hasPlacer, onPassage, placePassage, type PassageReq } from './passage';

type Choice = { category: CategoryId | null; plain: boolean };

export function PassageMenu() {
  const [req, setReq] = useState<PassageReq | null>(null);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(
    () =>
      onPassage((r) => {
        setReq(r);
        setCursor(0);
        setPos(null);
      }),
    [],
  );

  const choices: (Choice & { label: string; key: string; color: string; hint?: string })[] = [
    { category: null, plain: true, label: PLAIN_DEF.label, key: 'H', color: 'var(--cat-plain)', hint: 'par défaut' },
    ...CATEGORIES.map((c) => ({ category: c.id, plain: false, label: c.label, key: c.key, color: catColor(c.id) })),
  ];

  const pick = (c: Choice) => {
    const r = req;
    setReq(null);
    if (!r) return;
    const s = useStore.getState();
    if (!s.books.some((b) => b.id === r.bookId)) return;
    if (!hasPlacer()) {
      s.toast('Ouvrez une carte pour y poser le passage', 'info');
      return;
    }
    const h = s.addHighlight({ ...r.input, category: c.category, plain: c.plain || undefined, bookId: r.bookId });
    const id = placePassage(h.id, r.at);
    if (id) s.toast(c.plain ? 'Passage surligné et posé sur la carte' : `Extrait « ${CATEGORIES.find((x) => x.id === c.category)?.label} » posé sur la carte`, 'success');
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!req || !el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - r.width - 8, req.screen.x - 18)),
      top: Math.max(8, Math.min(window.innerHeight - r.height - 8, req.screen.y + 6)),
    });
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const byKey = choices.find((c) => c.key.toLowerCase() === k);
      let used = true;
      if (e.key === 'Escape') setReq(null);
      else if (e.key === 'Enter') pick(choices[cursor]);
      else if (e.key === 'ArrowDown') setCursor((c) => (c + 1) % choices.length);
      else if (e.key === 'ArrowUp') setCursor((c) => (c - 1 + choices.length) % choices.length);
      else if (byKey) pick(byKey);
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setReq(null);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', down, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('mousedown', down, true);
    };
  });

  if (!req) return null;
  const quote = req.input.text.replace(/\s+/g, ' ').trim();
  return createPortal(
    <div
      ref={ref}
      className="floating passage-menu anim-scale"
      role="menu"
      aria-label="Classer le passage"
      data-testid="passage-menu"
      style={{ left: pos?.left ?? req.screen.x, top: pos?.top ?? req.screen.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="passage-menu-head">
        <span>Poser sur la carte comme…</span>
        <p>« {quote.length > 110 ? `${quote.slice(0, 107).replace(/\s+\S*$/, '')}…` : quote} »</p>
      </div>
      {choices.map((c, i) => (
        <button
          key={c.label}
          role="menuitem"
          className={`menu-item passage-menu-item ${i === cursor ? 'focused' : ''}`}
          data-cat={c.category ?? 'plain'}
          style={{ '--c': c.color } as CSSProperties}
          onMouseEnter={() => setCursor(i)}
          onClick={() => pick(c)}
        >
          {c.plain ? <Highlighter size={13} className="passage-menu-ico" /> : <span className="passage-menu-dot" />}
          <span className="truncate">{c.label}</span>
          {c.hint && <span className="passage-menu-hint">{c.hint}</span>}
          <Kbd>{c.key}</Kbd>
        </button>
      ))}
    </div>,
    document.body,
  );
}
