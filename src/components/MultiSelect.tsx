// Briques d'interface de la sélection multiple (Bibliothèque, Écrits) :
// barre d'actions flottante, case à cocher des cartes, choix « Ajouter à un espace… ».
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Check, Folder, X } from 'lucide-react';
import { useStore } from '../lib/store';
import type { WorkspaceItemKind } from '../lib/types';
import { Modal } from '../features/workspaces/wsUi';
import { sortedGroups } from '../features/workspaces/wsModel';
import './multiselect.css';

/** « 3 livres sélectionnés ». */
export function selectedLabel(n: number, one: string, many: string, feminine = false) {
  const e = feminine ? 'e' : '';
  return n > 1 ? `${n} ${many} sélectionné${e}s` : `${n} ${one} sélectionné${e}`;
}

/** Barre d'actions flottante en bas de la vue, visible dès qu'un élément est sélectionné. */
export function SelectionActionBar({ count, label, children, onClear }: { count: number; label: string; children: ReactNode; onClear(): void }) {
  return (
    <>
      {/* Région d'annonce permanente : les lecteurs d'écran entendent chaque changement, y compris « aucune sélection ». */}
      <span className="msel-sr" role="status" aria-live="polite">
        {count ? `${count} ${label}` : ''}
      </span>
      {count > 0 && (
        <div className="msel-dock" data-no-lasso>
          <div className="msel-bar anim-in" role="toolbar" aria-label="Actions sur la sélection">
            <span className="msel-count">
              <span className="msel-badge">{count}</span>
              {label}
            </span>
            <span className="msel-sep" aria-hidden="true" />
            {children}
            <span className="msel-sep" aria-hidden="true" />
            <button className="btn btn-ghost btn-sm" onClick={onClear} title="Tout désélectionner (Échap)">
              <X size={13} /> Tout désélectionner
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Case à cocher posée sur une carte (mode « Sélectionner », ou dès qu'une sélection existe). */
export function SelectCheck({ checked, onToggle, label }: { checked: boolean; onToggle(): void; label: string }) {
  // <span> et non <button> : la case est posée dans des lignes qui sont elles-mêmes des boutons
  // (liste des concepts) — un bouton dans un bouton est du HTML invalide (avertissement React).
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={-1}
      className={`msel-check ${checked ? 'on' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

/** Choix d'un espace puis, éventuellement, d'un groupe ; ajoute toute la sélection d'un coup. */
export function AddToWorkspaceDialog({ kind, refIds, onClose, onDone }: { kind: WorkspaceItemKind; refIds: string[]; onClose(): void; onDone?(): void }) {
  const workspaces = useStore((s) => s.workspaces);
  const groups = useStore((s) => s.groups);
  const wsItems = useStore((s) => s.wsItems);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  const rows = useMemo(() => {
    const out: { wsId: string; groupId: string | null; name: string; depth: number; tint: string }[] = [];
    for (const w of [...workspaces].sort((a, b) => a.order - b.order)) {
      out.push({ wsId: w.id, groupId: null, name: w.name, depth: 0, tint: w.tint });
      const walk = (parent: string | null, depth: number) => {
        for (const g of sortedGroups(groups, w.id, parent)) {
          out.push({ wsId: w.id, groupId: g.id, name: g.name, depth, tint: w.tint });
          walk(g.id, depth + 1);
        }
      };
      walk(null, 1);
    }
    return out;
  }, [workspaces, groups]);

  const n = refIds.length;
  const noun = kind === 'draft' ? (n > 1 ? 'écrits' : 'écrit') : n > 1 ? 'livres' : 'livre';
  const present = (wsId: string, groupId: string | null) =>
    refIds.filter((id) => wsItems.some((i) => i.workspaceId === wsId && i.kind === kind && i.refId === id && i.groupId === groupId)).length;

  const add = (wsId: string, groupId: string | null, name: string) => {
    const st = useStore.getState();
    for (const id of refIds) st.addToWorkspace(wsId, groupId, kind, id);
    st.toast(n > 1 ? `${n} ${noun} ajoutés à « ${name} »` : `Ajouté à « ${name} »`, 'success');
    onClose();
    onDone?.();
  };

  return (
    <Modal title="Ajouter à un espace" onClose={onClose}>
      <div className="ws-pick">
        <header className="ws-pick-head">
          <div>
            <h3>Ajouter à un espace</h3>
            <span className="muted">
              {n} {noun} — choisissez un espace ou l’un de ses groupes.
            </span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </header>
        <div className="ws-pick-list ws-move-list msel-ws-list" role="list">
          {rows.length === 0 && <p className="muted ws-pick-empty">Aucun espace pour l’instant. Créez-en un depuis la barre latérale.</p>}
          {rows.map((r, i) => {
            const here = present(r.wsId, r.groupId);
            const all = here === n;
            return (
              <button
                key={r.wsId + ':' + (r.groupId ?? '')}
                ref={i === 0 ? first : undefined}
                role="listitem"
                className={`ws-move-row ${r.depth === 0 ? 'msel-ws-root' : ''}`}
                disabled={all}
                style={{ paddingLeft: 10 + r.depth * 14 }}
                onClick={() => add(r.wsId, r.groupId, r.name)}
              >
                {r.groupId ? <Folder size={14} /> : <span className="ws-dot" style={{ background: `var(${r.tint})` }} />}
                <span className="truncate">{r.name}</span>
                {here > 0 && <span className="muted ws-move-here">{all ? 'déjà présent' + (n > 1 ? 's' : '') : `${here} déjà présent${here > 1 ? 's' : ''}`}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
