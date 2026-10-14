// Briques d'interface partagées par l'arbre et la vue d'espace : menus, confirmation, saisie en ligne,
// sélecteurs (ajouter / déplacer) et aides de glisser-déposer.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen, ChevronRight, FilePen, Folder, ListTree, Network, ScrollText, Search, Sigma, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { WorkspaceItemKind } from '../../lib/types';
import {
  KIND_LABEL,
  dropOnto,
  canDrop,
  sortedGroups,
  subtreeIds,
  type DragPayload,
  type DropTarget,
} from './wsModel';
import { importFromDrop } from './wsActions';
import './workspaces.css';

export function ItemIcon({ kind, size = 14 }: { kind: WorkspaceItemKind; size?: number }) {
  const p = { size, strokeWidth: 1.8 };
  switch (kind) {
    case 'book':
      return <BookOpen {...p} />;
    case 'draft':
      return <FilePen {...p} />;
    case 'plan':
      return <ListTree {...p} />;
    case 'argument':
      return <Sigma {...p} />;
    case 'study':
      return <ScrollText {...p} />;
    case 'map':
      return <Network {...p} />;
  }
}

// ── Glisser-déposer ────────────────────────────────────────

let current: DragPayload | null = null;
export const getDrag = () => current;

export const hasFiles = (e: DragEvent | globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Props à étaler sur une source déplaçable. */
export function dragSource(payload: DragPayload, onEnd?: () => void) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      current = payload;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-marginalia-ws', payload.id);
      e.dataTransfer.setData('text/plain', payload.id);
    },
    onDragEnd: () => {
      current = null;
      onEnd?.();
    },
  };
}

export { dropOnto, canDrop };

export type DropMark = { key: string; pos: 'before' | 'after' | 'into'; file?: boolean };

export interface DropArgs {
  key: string;
  drop: DropMark | null;
  setDrop(d: DropMark | null): void;
  workspaceId: string;
  /** Groupe visé par un dépôt de fichiers. */
  groupId: string | null;
  zone?: (e: DragEvent, drag: DragPayload | null) => DropMark['pos'];
  target: (pos: DropMark['pos']) => DropTarget;
  expand?: () => void;
  expandLater?: (key: string, run: () => void) => void;
  cancelExpand?: () => void;
}

/**
 * Props de cible de dépôt (éléments, groupes, fichiers du Finder). On arrête la propagation des
 * évènements de fichiers : la DropOverlay globale de App.tsx ne doit pas importer en double.
 */
export function dropProps(a: DropArgs) {
  const { key } = a;
  const mark = a.drop?.key === key ? a.drop : null;
  return {
    mark,
    props: {
      onDragOver: (e: DragEvent) => {
        if (hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          if (a.drop?.key !== key) a.setDrop({ key, pos: 'into', file: true });
          if (a.expand) a.expandLater?.(key, a.expand);
          return;
        }
        const drag = getDrag();
        if (!drag) return;
        const pos = a.zone ? a.zone(e, drag) : 'into';
        if (!canDrop(drag, a.target(pos))) {
          if (a.drop?.key === key) a.setDrop(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (a.drop?.key !== key || a.drop.pos !== pos) a.setDrop({ key, pos });
        if (pos === 'into' && a.expand) a.expandLater?.(key, a.expand);
        else a.cancelExpand?.();
      },
      onDragEnter: (e: DragEvent) => {
        if (hasFiles(e)) e.stopPropagation();
      },
      onDragLeave: (e: DragEvent) => {
        if (hasFiles(e)) e.stopPropagation();
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
          if (a.drop?.key === key) a.setDrop(null);
          a.cancelExpand?.();
        }
      },
      onDrop: (e: DragEvent) => {
        a.cancelExpand?.();
        if (hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          a.setDrop(null);
          void importFromDrop(e.dataTransfer.files, a.workspaceId, a.groupId);
          return;
        }
        const drag = getDrag();
        a.setDrop(null);
        if (!drag) return;
        const pos = a.zone ? a.zone(e, drag) : 'into';
        if (!canDrop(drag, a.target(pos))) return;
        e.preventDefault();
        e.stopPropagation();
        dropOnto(drag, a.target(pos));
      },
    },
  };
}

// ── Modale ─────────────────────────────────────────────────

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="ws-modal-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`ws-modal panel anim-scale ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="ws-confirm">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="ws-confirm-actions">
          <button ref={cancel} className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-danger ws-danger-solid"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Saisie en ligne ────────────────────────────────────────

export function InlineName({
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
  className = '',
  label,
}: {
  initial?: string;
  placeholder: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
  className?: string;
  label: string;
}) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (v.trim()) onSubmit(v.trim());
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className={`ws-inline-input ${className}`}
      value={v}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
    />
  );
}

// ── Menu contextuel ────────────────────────────────────────

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  /** Sous-menu (remplace le contenu avec un retour). */
  children?: MenuEntry[];
  /** Pastille de couleur à gauche (teintes). */
  swatch?: string;
  checked?: boolean;
  hint?: string;
}

export function ContextMenu({ x, y, entries, onClose, label }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void; label: string }) {
  const [stack, setStack] = useState<{ title: string; entries: MenuEntry[] }[]>([]);
  const view = stack.length ? stack[stack.length - 1].entries : entries;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });
  const [focus, setFocus] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - r.width - 8, x)),
      top: Math.max(8, Math.min(window.innerHeight - r.height - 8, y)),
      ready: true,
    });
  }, [x, y, stack.length]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      const acts = view.map((en, i) => (en.sep || !en.label ? -1 : i)).filter((i) => i >= 0);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (stack.length) setStack((s) => s.slice(0, -1));
        else onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = acts.indexOf(focus);
        const next = e.key === 'ArrowDown' ? acts[(at + 1) % acts.length] : acts[(at - 1 + acts.length) % acts.length];
        setFocus(next);
      } else if (e.key === 'Enter' && focus >= 0) {
        e.preventDefault();
        activate(view[focus]);
      }
    };
    const scroll = () => onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', scroll);
    window.addEventListener('resize', scroll);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', scroll);
      window.removeEventListener('resize', scroll);
    };
  });

  const activate = (en: MenuEntry) => {
    if (en.children) {
      setStack((s) => [...s, { title: en.label ?? '', entries: en.children! }]);
      setFocus(-1);
      return;
    }
    onClose();
    en.onClick?.();
  };

  return createPortal(
    <div
      ref={ref}
      className="floating ws-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {stack.length > 0 && (
        <button className="menu-item ws-menu-back" onClick={() => setStack((s) => s.slice(0, -1))}>
          <ArrowLeft size={14} /> {stack[stack.length - 1].title}
        </button>
      )}
      {view.map((en, i) =>
        en.sep ? (
          <div key={i} className="divider" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${focus === i ? 'focused' : ''} ${en.danger ? 'ws-danger' : ''}`}
            onMouseEnter={() => setFocus(i)}
            onClick={() => activate(en)}
          >
            {en.swatch ? <span className="ws-swatch" style={{ background: `var(${en.swatch})` }} /> : <span className="ws-menu-ico">{en.icon}</span>}
            <span className="truncate">{en.label}</span>
            {en.checked && <span className="ws-check">•</span>}
            {en.children && <ChevronRight size={13} className="ws-menu-more" />}
            {en.hint && <span className="ws-menu-hint">{en.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Hook : état d'un menu contextuel ouvert à une position. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  return {
    menu,
    open: (x: number, y: number, entries: MenuEntry[], label: string) => setMenu({ x, y, entries, label }),
    close: () => setMenu(null),
  };
}

// ── Sélecteur « Ajouter à l'espace » ───────────────────────

const PICK_KINDS: WorkspaceItemKind[] = ['book', 'draft', 'plan', 'argument', 'study', 'map'];
const PICK_LABEL: Record<WorkspaceItemKind, string> = {
  book: 'Livres',
  draft: 'Écrits',
  plan: 'Plans',
  argument: 'Arguments',
  study: 'Fiches-texte',
  map: 'Cartes',
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function AddItemsDialog({ workspaceId, groupId, onClose }: { workspaceId: string; groupId: string | null; onClose: () => void }) {
  const books = useStore((s) => s.books);
  const drafts = useStore((s) => s.drafts);
  const plans = useStore((s) => s.plans);
  const args = useStore((s) => s.arguments);
  const studies = useStore((s) => s.studies);
  const maps = useStore((s) => s.maps);
  const wsItems = useStore((s) => s.wsItems);
  const group = useStore((s) => s.groups.find((g) => g.id === groupId));
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const addToWorkspace = useStore((s) => s.addToWorkspace);
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<WorkspaceItemKind>('book');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Map<string, { kind: WorkspaceItemKind; refId: string }>>(new Map());
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);

  const rows = useMemo(() => {
    const m: Record<WorkspaceItemKind, { id: string; title: string; sub: string }[]> = {
      book: books.map((b) => ({ id: b.id, title: b.title, sub: b.author })),
      draft: drafts.map((d) => ({ id: d.id, title: d.title || 'Sans titre', sub: `${d.wordCount} mots` })),
      plan: plans.map((p) => ({ id: p.id, title: p.title || 'Plan sans titre', sub: p.sujet })),
      argument: args.map((a) => ({ id: a.id, title: a.title || 'Argument sans titre', sub: a.conclusion.text })),
      study: studies.map((x) => ({ id: x.id, title: x.title || 'Fiche sans titre', sub: books.find((b) => b.id === x.bookId)?.title ?? '' })),
      map: books.filter((b) => (maps[b.id]?.nodes.length ?? 0) > 0).map((b) => ({ id: b.id, title: `Carte — ${b.title}`, sub: `${maps[b.id].nodes.length} nœuds` })),
    };
    return m;
  }, [books, drafts, plans, args, studies, maps]);

  const inWs = (k: WorkspaceItemKind, id: string) => wsItems.some((i) => i.workspaceId === workspaceId && i.kind === k && i.refId === id);
  const shown = rows[kind].filter((r) => !q.trim() || fold(`${r.title} ${r.sub}`).includes(fold(q.trim())));
  const keyOf = (k: WorkspaceItemKind, id: string) => `${k}:${id}`;

  const toggle = (k: WorkspaceItemKind, id: string) =>
    setSel((s) => {
      const n = new Map(s);
      const key = keyOf(k, id);
      if (n.has(key)) n.delete(key);
      else n.set(key, { kind: k, refId: id });
      return n;
    });

  const confirm = () => {
    for (const v of sel.values()) addToWorkspace(workspaceId, groupId, v.kind, v.refId);
    toast(sel.size === 1 ? 'Élément ajouté' : `${sel.size} éléments ajoutés`, 'success');
    onClose();
  };

  return (
    <Modal title="Ajouter à l’espace" onClose={onClose} wide>
      <div className="ws-pick">
        <header className="ws-pick-head">
          <div>
            <h3>Ajouter à {group ? `« ${group.name} »` : ws ? `« ${ws.name} »` : 'l’espace'}</h3>
            <span className="muted">Cochez un ou plusieurs éléments.</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </header>
        <div className="ws-pick-tabs" role="tablist">
          {PICK_KINDS.map((k) => {
            const n = [...sel.keys()].filter((x) => x.startsWith(k + ':')).length;
            return (
              <button key={k} role="tab" aria-selected={kind === k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                {PICK_LABEL[k]}
                <span className={`ws-pick-n ${n ? 'sel' : ''}`}>{n || rows[k].length}</span>
              </button>
            );
          })}
        </div>
        <label className="ws-pick-search">
          <Search size={14} />
          <input ref={search} placeholder={`Rechercher parmi les ${PICK_LABEL[kind].toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="ws-pick-list">
          {shown.length === 0 && (
            <p className="muted ws-pick-empty">
              {rows[kind].length === 0 ? `Aucun élément de ce type pour l’instant.` : 'Aucun résultat.'}
            </p>
          )}
          {shown.map((r) => {
            const already = inWs(kind, r.id);
            const on = sel.has(keyOf(kind, r.id));
            return (
              <label key={r.id} className={`ws-pick-row ${already ? 'disabled' : ''} ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on || already} disabled={already} onChange={() => toggle(kind, r.id)} />
                <span className="ws-pick-ico">
                  <ItemIcon kind={kind} />
                </span>
                <span className="ws-pick-title truncate">{r.title}</span>
                <span className="ws-pick-sub truncate muted">{already ? 'Déjà dans l’espace' : r.sub}</span>
              </label>
            );
          })}
        </div>
        <footer className="ws-pick-foot">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={!sel.size} onClick={confirm}>
            {sel.size ? `Ajouter ${sel.size} élément${sel.size > 1 ? 's' : ''}` : 'Ajouter'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

// ── Sélecteur « Déplacer vers… » ───────────────────────────

export function MoveDialog({ payload, onClose }: { payload: DragPayload; onClose: () => void }) {
  const groups = useStore((s) => s.groups);
  const ws = useStore((s) => s.workspaces.find((w) => w.id === payload.workspaceId));
  const item = useStore((s) => s.wsItems.find((i) => i.id === payload.id));
  const toast = useStore((s) => s.toast);

  const rows = useMemo(() => {
    const out: { id: string | null; name: string; depth: number }[] = [{ id: null, name: ws?.name ?? 'Espace', depth: 0 }];
    const walk = (parent: string | null, depth: number) => {
      for (const g of sortedGroups(groups, payload.workspaceId, parent)) {
        out.push({ id: g.id, name: g.name, depth });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  }, [groups, payload.workspaceId, ws?.name]);

  const forbidden = payload.type === 'group' ? subtreeIds(groups, payload.id) : new Set<string>();
  const currentParent = payload.type === 'item' ? (item?.groupId ?? null) : (groups.find((g) => g.id === payload.id)?.parentId ?? null);

  return (
    <Modal title="Déplacer vers" onClose={onClose}>
      <div className="ws-pick">
        <header className="ws-pick-head">
          <div>
            <h3>Déplacer vers…</h3>
            <span className="muted">Choisissez la destination dans l’espace.</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </header>
        <div className="ws-pick-list ws-move-list">
          {rows.map((r) => {
            const bad = (r.id !== null && forbidden.has(r.id)) || r.id === currentParent;
            return (
              <button
                key={r.id ?? 'root'}
                className="ws-move-row"
                disabled={bad}
                style={{ paddingLeft: 10 + r.depth * 12 }}
                onClick={() => {
                  const target: DropTarget = r.id ? { kind: 'group', groupId: r.id, pos: 'into' } : { kind: 'workspace', workspaceId: payload.workspaceId };
                  if (dropOnto(payload, target)) toast(`Déplacé vers « ${r.name} »`, 'success');
                  onClose();
                }}
              >
                {r.id ? <Folder size={14} /> : <span className="ws-dot" style={{ background: `var(${ws?.tint ?? '--cat-these'})` }} />}
                <span className="truncate">{r.name}</span>
                {r.id === currentParent && <span className="muted ws-move-here">Emplacement actuel</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
