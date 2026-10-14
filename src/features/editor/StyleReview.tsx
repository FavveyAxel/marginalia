// Panneau « Revue de style » : relecture automatique d'une dissertation / explication.
// L'analyse (styleRules.ts) est différée : jamais pendant la frappe (debounce + requestIdleCallback).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, SearchCheck, X } from 'lucide-react';
import type { Draft } from '../../lib/types';
import type { DocEngine, EngineStats } from './engine';
import './style-review.css';
import { analyze, CATEGORY_INFO, CATEGORY_ORDER, countByCategory, type StyleCategory, type StyleFinding } from './styleRules';

const DEBOUNCE_MS = 1400;
const FLASH_MS = 2200;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Seg {
  off: number;
  len: number;
  pos: number;
}
interface ParaInfo {
  text: string;
  segs: Seg[];
}
interface Item {
  f: StyleFinding;
  before: string;
  after: string;
}

const HEADING_RE = /^(heading|titre|title|subtitle|sous-?titre|toc|tdm)/i;

/** Paragraphes de corps (hors titres / sommaire) avec la correspondance texte → position du document. */
function collect(ed: Any): ParaInfo[] {
  const out: ParaInfo[] = [];
  ed?.state?.doc?.descendants((n: Any, pos: number) => {
    if (!n.isTextblock) return true;
    const sid = String(n.attrs?.paragraphProperties?.styleId ?? '');
    if (!HEADING_RE.test(sid)) {
      let text = '';
      const segs: Seg[] = [];
      n.descendants((c: Any, p: number) => {
        if (c.isText) {
          segs.push({ off: text.length, len: c.text.length, pos: pos + 1 + p });
          text += c.text;
        } else if (c.isLeaf) text += ' ';
        return true;
      });
      if (text.trim()) out.push({ text, segs });
    }
    return false;
  });
  return out;
}

/** Offset de caractère dans le paragraphe → position dans le document. */
function toPos(p: ParaInfo, off: number): number | null {
  for (const s of p.segs) if (off >= s.off && off <= s.off + s.len) return s.pos + (off - s.off);
  return null;
}

const flat = (s: string) => s.replace(/[’‘]/g, "'").replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

function engineParts(engine: DocEngine | null): { ed: Any; pres: Any } | null {
  try {
    const d = engine?.debugEditor() as Any;
    const ed = d?.editor;
    if (!ed) return null;
    const docs = d.superdoc?.superdocStore?.documents;
    const pres = docs?.[0]?.getPresentationEditor?.() ?? ed.presentationEditor ?? null;
    return { ed, pres };
  } catch {
    return null;
  }
}

const idle = (fn: () => void): (() => void) => {
  const w = window as Any;
  if (typeof w.requestIdleCallback === 'function') {
    const h = w.requestIdleCallback(fn, { timeout: 2500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = setTimeout(fn, 50);
  return () => clearTimeout(h);
};

interface Flash {
  key: number;
  rects: { left: number; top: number; width: number; height: number }[];
}

export function StyleReview({ draft, engine, stats, onClose }: { draft: Draft; engine: () => DocEngine | null; stats: EngineStats; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [pending, setPending] = useState(true);
  const [open, setOpen] = useState<Record<StyleCategory, boolean>>({ long: true, repeat: true, adverb: true, tic: true, connector: true, jepense: true });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const paras = useRef<ParaInfo[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSeq = useRef(0);
  const firstPerson = draft.template !== 'fiche';
  // `engine` change d'identité à chaque rendu du parent : on le garde en référence pour ne pas relancer l'analyse.
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const run = useCallback(() => {
    const parts = engineParts(engineRef.current());
    if (!parts) return;
    const ps = collect(parts.ed);
    paras.current = ps;
    const found = analyze(ps.map((p) => p.text), { firstPerson });
    setItems(
      found.map((f) => {
        const t = ps[f.para].text;
        return { f, before: t.slice(Math.max(0, f.from - 36), f.from), after: t.slice(f.to, f.to + 36) };
      }),
    );
    setPending(false);
  }, [firstPerson]);

  // Analyse différée : à l'ouverture, puis 1,4 s après la dernière modification (stats change à chaque mise à jour du contenu).
  useEffect(() => {
    setPending(true);
    let cancelIdle: (() => void) | null = null;
    const t = setTimeout(() => {
      cancelIdle = idle(run);
    }, items === null ? 120 : DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      cancelIdle?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, run]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const counts = useMemo(() => countByCategory((items ?? []).map((i) => i.f)), [items]);
  const total = items?.length ?? 0;

  const drawFlash = useCallback((pres: Any, ed: Any) => {
    let rects: Any[] = [];
    try {
      rects = pres?.getSelectionRects?.() ?? [];
    } catch {
      rects = [];
    }
    if (!rects.length) {
      const r = engineRef.current()?.selectionRect();
      if (r) rects = [{ left: r.left, right: r.right, top: r.top, bottom: r.bottom }];
    }
    void ed;
    if (!rects.length) return;
    const key = ++flashSeq.current;
    setFlash({ key, rects: rects.map((r: Any) => ({ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top })) });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash((f) => (f && f.key === key ? null : f)), FLASH_MS);
  }, []);

  const reveal = (it: Item) => {
    const parts = engineParts(engineRef.current());
    const p = paras.current[it.f.para];
    if (!parts || !p) return;
    const a = toPos(p, it.f.from);
    const b = toPos(p, it.f.to);
    let valid = a !== null && b !== null && b > a;
    if (valid) {
      try {
        valid = flat(parts.ed.state.doc.textBetween(a!, b!, ' ', ' ')) === flat(it.f.text);
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      // le texte a changé depuis l'analyse : on relance, sans sélectionner un mauvais passage
      run();
      return;
    }
    setSelected(it.f.id);
    try {
      parts.ed.commands.setTextSelection({ from: a!, to: b! });
    } catch {
      return;
    }
    const pres = parts.pres;
    const scroll = pres?.scrollToPositionAsync ?? pres?.scrollToPosition;
    try {
      Promise.resolve(scroll?.call(pres, a!, { block: 'center', behavior: 'smooth' })).catch(() => undefined);
    } catch {
      /* défilement indisponible */
    }
    parts.ed.view?.focus?.();
    setFlash(null);
    // surlignage une fois le défilement posé
    setTimeout(() => drawFlash(pres, parts.ed), 520);
  };

  // le surlignage est fixe à l'écran : on le retire dès que la page défile
  useEffect(() => {
    if (!flash) return;
    const off = () => setFlash(null);
    const scroller = document.querySelector('.ed-scroll');
    scroller?.addEventListener('scroll', off, { passive: true, once: true });
    return () => scroller?.removeEventListener('scroll', off);
  }, [flash]);

  return (
    <aside className="ed-style panel anim-slide" aria-label="Revue de style" data-testid="style-review">
      <div className="ed-style-head">
        <h2>Revue de style</h2>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer la revue de style" title="Fermer">
          <X size={15} />
        </button>
      </div>
      <div className="ed-style-sum" aria-live="polite">
        {items === null ? (
          'Analyse en cours…'
        ) : total === 0 ? (
          <>
            <SearchCheck size={14} /> Rien à signaler pour l’instant.
          </>
        ) : (
          <>
            <strong>{total}</strong> point{total > 1 ? 's' : ''} à relire{pending ? ' · mise à jour…' : ''}
          </>
        )}
      </div>
      <div className="ed-style-list">
        {CATEGORY_ORDER.map((cat) => {
          const list = (items ?? []).filter((i) => i.f.cat === cat);
          return (
            <section key={cat} className={`sr-cat sr-${cat}`} data-cat={cat} data-count={list.length}>
              <button className="sr-cat-head" onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))} aria-expanded={open[cat]} title={CATEGORY_INFO[cat].hint}>
                <ChevronDown size={13} className={`sr-chev ${open[cat] ? '' : 'closed'}`} />
                <span className="sr-cat-label">{CATEGORY_INFO[cat].label}</span>
                <span className={`sr-count ${counts[cat] ? '' : 'zero'}`}>{counts[cat]}</span>
              </button>
              {open[cat] && list.length > 0 && (
                <ul className="sr-items">
                  {list.map((it) => (
                    <li key={it.f.id}>
                      <button className={`sr-item ${selected === it.f.id ? 'on' : ''}`} onClick={() => reveal(it)} data-finding={it.f.id}>
                        {it.f.cat === 'long' || it.f.cat === 'connector' ? (
                          <span className="sr-quote">{clip(it.f.text, 120)}</span>
                        ) : (
                          <span className="sr-quote">
                            <span className="sr-ctx">{it.before.length >= 36 ? '…' : ''}{it.before}</span>
                            <mark>{it.f.text}</mark>
                            <span className="sr-ctx">{it.after}{it.after.length >= 36 ? '…' : ''}</span>
                          </span>
                        )}
                        <span className="sr-msg">{it.f.msg}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {flash &&
        createPortal(
          <div className="sr-flash-layer" aria-hidden="true">
            {flash.rects.map((r, i) => (
              <div key={`${flash.key}-${i}`} className="sr-flash" style={{ left: r.left - 2, top: r.top - 1, width: r.width + 4, height: r.height + 2 }} />
            ))}
          </div>,
          document.body,
        )}
    </aside>
  );
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}
