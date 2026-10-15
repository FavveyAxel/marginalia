// Cartes de la carte d'argument : extraits du livre (typographie de citation, repliables)
// et idées de l'utilisateur (post-it manuscrit).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../../../lib/store';
import { NOTE_KIND_BY_ID, kindColor } from '../../../lib/categories';
import { locatorOf } from '../../../lib/citation';
import { roleLabel, useMapCtx, type ExtractData, type IdeaData } from './ctx';

const sides: [Position, string][] = [
  [Position.Top, 't'],
  [Position.Right, 'r'],
  [Position.Bottom, 'b'],
  [Position.Left, 'l'],
];
export const Handles = () => (
  <>
    {sides.map(([p, id]) => (
      <Handle key={id} id={id} type="source" position={p} className={`map-h map-h-${id}`} />
    ))}
  </>
);

/** Nombre de lignes visibles d'un extrait replié. */
const CLAMP_LINES = 3;

/** Mesure le texte : dépasse-t-il 3 lignes ? hauteur complète et hauteur repliée. */
function useClamp(text: string) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [m, setM] = useState({ long: false, full: 0, clamp: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const full = el.scrollHeight;
      const clamp = Math.round(lh * CLAMP_LINES);
      setM((o) => (o.full === full && o.clamp === clamp ? o : { long: full > clamp + 4, full, clamp }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return [ref, m] as const;
}

export function ExtractNode({ id, data, selected }: NodeProps) {
  const ctx = useMapCtx();
  const d = data as ExtractData;
  const h = d.highlight;
  const conceptNames = useStore(useShallow((s) => (h ? (h.conceptIds.map((cid) => s.concepts.find((c) => c.id === cid)?.name).filter(Boolean) as string[]) : [])));
  const text = (h?.text ?? '').replace(/\s+/g, ' ').trim();
  const [pRef, m] = useClamp(text);
  if (!h) {
    return (
      <div className="map-node map-extract missing" style={{ '--c': 'var(--faint)' } as CSSProperties}>
        <div className="map-node-head">
          <span className="map-node-cat">Extrait</span>
        </div>
        <p className="map-node-text muted">Extrait introuvable</p>
        <Handles />
      </div>
    );
  }
  const collapsed = m.long && (d.collapsed ?? true);
  const label = d.central ? 'Thèse centrale' : roleLabel(h);
  return (
    <div
      className={`map-node map-extract ${d.central ? 'central' : ''} ${collapsed ? 'collapsed' : ''} ${m.long ? 'long' : ''} ${selected ? 'sel' : ''}`}
      style={{ '--c': kindColor(h) } as CSSProperties}
      data-cat={h.category ?? (h.plain ? 'plain' : 'note')}
      onDoubleClick={() => ctx.jump(h.id)}
      title="Double-clic : retrouver dans le texte"
    >
      <div className="map-node-head">
        <span className="map-node-cat">{label}</span>
        <span className="map-node-loc">
          {d.book && (
            <b className="map-node-book" title={d.book}>
              {d.book}
            </b>
          )}
          {locatorOf(h)}
        </span>
      </div>
      <div className="map-node-quote" style={m.long ? { maxHeight: collapsed ? m.clamp : m.full + 2 } : undefined}>
        <p ref={pRef} className="map-node-text">
          {text}
        </p>
      </div>
      {m.long && (
        <button
          type="button"
          className="map-node-more nodrag"
          data-act="toggle-collapse"
          aria-expanded={!collapsed}
          onClick={(e) => {
            e.stopPropagation();
            ctx.setCollapsed(id, !collapsed);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {collapsed ? 'Lire la suite' : 'Replier'}
          <ChevronDown size={12} />
        </button>
      )}
      {h.note.trim() && (
        <p className="map-node-note">
          {h.noteKind && <b>{NOTE_KIND_BY_ID[h.noteKind].label}</b>} {h.note}
        </p>
      )}
      {conceptNames.length > 0 && (
        <div className="map-node-concepts">
          {conceptNames.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      )}
      <Handles />
    </div>
  );
}

export function IdeaNode({ id, data, selected }: NodeProps) {
  const ctx = useMapCtx();
  const d = data as IdeaData;
  const text = d.text;
  const editing = ctx.editingId === id;
  const [draft, setDraft] = useState(text);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const closing = useRef(false);
  useEffect(() => {
    if (editing) {
      setDraft(text);
      closing.current = false;
    }
  }, [editing, text]);
  // Le champ grandit avec le texte.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);
  const done = () => {
    if (closing.current) return;
    closing.current = true;
    ctx.setEditingId(null);
    // Une carte vide reste sur la carte (on peut la déplacer, la relier, l'écrire plus tard) ;
    // elle ne disparaît que par une suppression explicite.
    if (draft.trim() !== text) ctx.setIdeaText(id, draft.trim());
  };
  return (
    <div
      className={`map-node map-idea ${d.central ? 'central' : ''} ${editing ? 'editing' : ''} ${selected ? 'sel' : ''}`}
      style={{ '--c': d.color ? `var(${d.color})` : 'var(--cat-these)' } as CSSProperties}
      data-color={d.color ?? 'jaune'}
      onDoubleClick={() => ctx.setEditingId(id)}
    >
      <div className="map-node-head">
        <span className="map-node-cat">{d.central ? 'Thèse centrale' : 'Idée'}</span>
      </div>
      {editing ? (
        <textarea
          ref={ta}
          className="map-idea-input nodrag nowheel nopan"
          autoFocus
          rows={2}
          value={draft}
          placeholder="Une idée, une objection, un lien…"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onBlur={done}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              done();
            } else if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              closing.current = true;
              ctx.editTab(id, draft.trim());
            }
          }}
        />
      ) : (
        <p className={`map-idea-text ${text ? '' : 'placeholder'}`}>{text || 'Double-clic pour écrire'}</p>
      )}
      <Handles />
    </div>
  );
}

export const nodeTypes = { extract: ExtractNode, idea: IdeaNode };
