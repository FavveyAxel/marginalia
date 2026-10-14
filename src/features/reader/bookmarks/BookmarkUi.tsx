// Signets : commandes (⌘D, ⌘⌥↓ / ⌘⌥↑), popover de libellé, liste du panneau latéral.
// Partagé par le lecteur et par le lecteur compact du panneau de l'éditeur.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { BookmarkPlus, Palette, Pencil, Trash2 } from 'lucide-react';
import { useStore, selectBookBookmarks } from '../../../lib/store';
import type { Bookmark, BookmarkColor } from '../../../lib/types';
import { Kbd, useFloating } from '../../../components/ui';
import type { BookmarkPoint, EngineHandle } from '../engine';
import { BOOKMARK_COLORS, bookmarkColor, clipWords, neighbour, sortBookmarks, whereOf } from './bookmarks';
import './bookmarks.css';

export interface BmPopoverState {
  id: string;
  rect: DOMRect;
  isNew: boolean;
}

/** Crée un signet à l'endroit indiqué par le moteur. */
export function addBookmarkAt(bookId: string, point: BookmarkPoint): Bookmark {
  return useStore.getState().addBookmark({
    bookId,
    position: point.position,
    anchor: point.anchor,
    excerpt: point.excerpt,
    progress: point.progress,
    locationLabel: point.locationLabel,
    label: point.label,
  });
}

const bookmarksOf = (bookId: string) => useStore.getState().bookmarks.filter((b) => b.bookId === bookId);

/**
 * Commandes de signets pour un volet de lecture.
 * `ctx()` : livre et moteur actifs au moment de la commande ; `anchor()` : où ancrer le popover.
 */
export function bookmarkCommands(
  ctx: () => { bookId: string; engine: EngineHandle | null } | null,
  openPopover: (p: BmPopoverState) => void,
  anchor: () => DOMRect | null,
) {
  const toast = (m: string) => useStore.getState().toast(m);
  return {
    /** ⌘D : ajoute un signet à l'endroit lu (ou ouvre celui qui s'y trouve déjà). */
    toggle() {
      const c = ctx();
      const eng = c?.engine;
      if (!c || !eng?.bookmarkPoint) return;
      const list = bookmarksOf(c.bookId);
      const at = eng.bookmarkAtView?.(list) ?? null;
      if (at) {
        const rect = anchor() ?? eng.getBookmarkRect?.(at);
        if (rect) openPopover({ id: at, rect, isNew: false });
        return;
      }
      const point = eng.bookmarkPoint();
      if (!point) return toast('Le document n’est pas encore prêt');
      const b = addBookmarkAt(c.bookId, point);
      const open = () => {
        const rect = anchor() ?? eng.getBookmarkRect?.(b.id);
        if (rect) openPopover({ id: b.id, rect, isNew: true });
      };
      requestAnimationFrame(() => requestAnimationFrame(open));
    },
    go(dir: 1 | -1) {
      const c = ctx();
      const eng = c?.engine;
      if (!c || !eng?.goToBookmark) return;
      const list = bookmarksOf(c.bookId);
      if (!list.length) return toast('Aucun signet dans ce document (⌘D pour en ajouter un)');
      const n = neighbour(list, eng.bookmarkPoint?.() ?? null, eng.bookmarkAtView?.(list) ?? null, dir);
      if (!n) return toast(dir === 1 ? 'Pas de signet plus loin' : 'Pas de signet avant');
      eng.goToBookmark(n);
    },
  };
}

/** ⌘D, ⌘⌥↓, ⌘⌥↑ (dans un champ de saisie : seulement si `allowInInput`). */
export function bookmarkKey(e: KeyboardEvent): 'toggle' | 'next' | 'prev' | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  if (!e.altKey && !e.shiftKey && e.code === 'KeyD') return 'toggle';
  if (e.altKey && !e.shiftKey && e.key === 'ArrowDown') return 'next';
  if (e.altKey && !e.shiftKey && e.key === 'ArrowUp') return 'prev';
  return null;
}

// ── Pastilles de couleur ─────────────────────────────────────

function Swatches({ value, onPick }: { value: BookmarkColor | null | undefined; onPick(c: BookmarkColor | null): void }) {
  return (
    <div className="bm-swatches" role="radiogroup" aria-label="Couleur du signet">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        className={`bm-swatch bm-swatch-none ${!value ? 'is-on' : ''}`}
        title="Sans couleur"
        onClick={() => onPick(null)}
      />
      {BOOKMARK_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          className={`bm-swatch ${value === c.id ? 'is-on' : ''}`}
          style={{ '--bm-c': `var(${c.cssVar})` } as CSSProperties}
          title={c.label}
          aria-label={c.label}
          onClick={() => onPick(c.id)}
        />
      ))}
    </div>
  );
}

// ── Popover : libellé, couleur, note ─────────────────────────

export function BookmarkPopover({ id, rect, isNew, onClose }: BmPopoverState & { onClose(): void }) {
  const b = useStore((s) => s.bookmarks.find((x) => x.id === id) ?? null);
  const [ref, style] = useFloating(rect, 'below');
  const [label, setLabel] = useState(b?.label ?? '');
  const [note, setNote] = useState(b?.note ?? '');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ label, note });
  latest.current = { label, note };

  const commit = () => {
    const cur = useStore.getState().bookmarks.find((x) => x.id === id);
    if (!cur) return;
    const l = latest.current.label.replace(/\s+/g, ' ').trim() || cur.label;
    const n = latest.current.note.trim();
    const patch: Partial<Bookmark> = {};
    if (l !== cur.label) patch.label = l;
    if (n !== (cur.note ?? '')) patch.note = n || undefined;
    if (Object.keys(patch).length) useStore.getState().updateBookmark(id, patch);
  };
  const done = () => {
    commit();
    onClose();
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useEffect(() => {
    if (!b) onClose();
  }, [!b]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) done();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => window.addEventListener('mousedown', down, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  if (!b) return null;
  return createPortal(
    <div
      ref={(el) => {
        boxRef.current = el;
        ref(el);
      }}
      className="floating bm-pop"
      style={{ ...style, '--bm-c': bookmarkColor(b.color) } as CSSProperties}
      role="dialog"
      aria-label="Signet"
      data-bm-pop={id}
    >
      <div className="bm-pop-head">
        <span className="bm-ribbon" aria-hidden />
        <span>{isNew ? 'Signet ajouté' : 'Signet'}</span>
        <span className="bm-where truncate">{whereOf(b)}</span>
      </div>
      <input
        ref={inputRef}
        className="input"
        aria-label="Libellé du signet"
        placeholder="Libellé"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            done();
          }
        }}
      />
      <input
        className="input"
        aria-label="Note (facultative)"
        placeholder="Note (facultative)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            done();
          }
        }}
      />
      <Swatches value={b.color} onPick={(c) => useStore.getState().updateBookmark(id, { color: c })} />
      <div className="bm-pop-foot">
        <button
          className="btn btn-ghost btn-sm btn-danger"
          onClick={() => {
            onClose();
            useStore.getState().removeBookmark(id);
          }}
        >
          <Trash2 size={13} /> Supprimer
        </button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={done}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── Liste du panneau latéral ─────────────────────────────────

const BookmarkRow = memo(function BookmarkRow({ b, current, index, onGo }: { b: Bookmark; current: boolean; index: number; onGo(b: Bookmark): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.label);
  const [colors, setColors] = useState(false);
  const update = useStore((s) => s.updateBookmark);
  const remove = useStore((s) => s.removeBookmark);

  const save = () => {
    setEditing(false);
    const l = draft.replace(/\s+/g, ' ').trim();
    if (l && l !== b.label) update(b.id, { label: l });
    else setDraft(b.label);
  };
  const excerpt = b.excerpt ? (b.excerpt.length >= 40 ? clipWords(b.excerpt, b.excerpt.replace(/\s+/g, ' ').trim().length - 1) : clipWords(b.excerpt, 60)) : '';
  const showExcerpt = !!excerpt && !b.label.includes(excerpt.replace(/…$/, '').slice(0, 18));

  return (
    <li
      className={`bm-row ${current ? 'is-current' : ''}`}
      data-bm-row={b.id}
      style={{ '--bm-c': bookmarkColor(b.color), '--i': index } as CSSProperties}
      aria-current={current ? 'location' : undefined}
    >
      <div
        className="bm-row-main"
        role="button"
        tabIndex={0}
        title="Aller au signet"
        onClick={() => !editing && onGo(b)}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onGo(b);
          } else if (e.key === 'F2') {
            e.preventDefault();
            setDraft(b.label);
            setEditing(true);
          } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            remove(b.id);
          }
        }}
      >
        <span className="bm-ribbon" aria-hidden />
        <span className="bm-row-text">
          {editing ? (
            <input
              className="input bm-row-label-input"
              autoFocus
              aria-label="Renommer le signet"
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={save}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') save();
                else if (e.key === 'Escape') {
                  setDraft(b.label);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span className="bm-row-label" onDoubleClick={(e) => (e.stopPropagation(), setDraft(b.label), setEditing(true))}>
              {b.label}
            </span>
          )}
          <span className="bm-row-where">
            {whereOf(b)}
            {b.source?.app === 'livres' && (
              <span className="src-livres" title="Venu de l’app Livres (synchronisé)">
                Livres
              </span>
            )}
          </span>
          {showExcerpt && <span className="bm-row-excerpt">« {excerpt} »</span>}
          {b.note && <span className="bm-row-note">{b.note}</span>}
        </span>
      </div>
      {!editing && (
        <div className="bm-row-actions">
          <button
            className="icon-btn sm"
            title="Renommer"
            aria-label="Renommer le signet"
            onClick={() => {
              setDraft(b.label);
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
          <button className={`icon-btn sm ${colors ? 'active' : ''}`} title="Couleur" aria-label="Couleur du signet" onClick={() => setColors((v) => !v)}>
            <Palette size={13} />
          </button>
          <button className="icon-btn sm is-danger" title="Supprimer" aria-label="Supprimer le signet" onClick={() => remove(b.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {colors && (
        <div className="anim-fade">
          <Swatches
            value={b.color}
            onPick={(c) => {
              update(b.id, { color: c });
              setColors(false);
            }}
          />
        </div>
      )}
    </li>
  );
});

export function BookmarksPanel({
  bookId,
  currentId,
  onGo,
  onAdd,
  canAdd = true,
}: {
  bookId: string;
  currentId: string | null;
  onGo(b: Bookmark): void;
  onAdd(): void;
  canAdd?: boolean;
}) {
  const list = useStore(useShallow(selectBookBookmarks(bookId)));
  const sorted = useMemo(() => sortBookmarks(list), [list]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!currentId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-bm-row="${CSS.escape(currentId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return (
    <div className="bm-panel" data-testid="bookmarks-panel">
      {canAdd && (
        <div className="bm-panel-head">
          <button className="btn btn-sm bm-add" onClick={onAdd} disabled={!!currentId} title={currentId ? 'Cet endroit a déjà un signet' : 'Ajouter un signet à l’endroit lu'}>
            <BookmarkPlus size={14} /> {currentId ? 'Endroit déjà marqué' : 'Ajouter un signet ici'} <Kbd>⌘D</Kbd>
          </button>
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="bm-empty anim-fade">
          <span className="bm-ribbon" aria-hidden />
          <strong>Aucun signet</strong>
          Marquez un endroit pour le retrouver d’un clic : <Kbd>⌘D</Kbd>, ou clic droit dans le texte.
        </div>
      ) : (
        <ol className="bm-list anim-stagger" ref={listRef} aria-label="Signets, dans l’ordre du texte">
          {sorted.map((b, i) => (
            <BookmarkRow key={b.id} b={b} index={i} current={b.id === currentId} onGo={onGo} />
          ))}
        </ol>
      )}
      {sorted.length > 1 && (
        <div className="bm-foot">
          <span>
            <Kbd>⌘⌥↓</Kbd> suivant
          </span>
          <span>
            <Kbd>⌘⌥↑</Kbd> précédent
          </span>
        </div>
      )}
    </div>
  );
}
