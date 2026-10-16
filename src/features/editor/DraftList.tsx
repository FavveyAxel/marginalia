// Liste des écrits (route { name: 'write', draftId: null }).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { BookOpenText, CheckSquare, ChevronDown, FileText, FolderOpen, FolderPlus, GraduationCap, MoreHorizontal, NotebookPen, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../lib/store';
import type { Draft } from '../../lib/types';
import { relativeTime } from '../../components/ui';
import { createFromTemplateImpl, openDocxFromDiskImpl } from './impl';
import { TEMPLATES, type TemplateId, type TemplateKey } from './templates';
import { Popover, usePop } from './Popover';
import { setExternalDirty, words } from './save';
import { useMultiSelect, useLasso, useSelectionKeys, LassoBox, type ClickMods } from '../../lib/useMultiSelect';
import { SelectionActionBar, SelectCheck, AddToWorkspaceDialog } from '../../components/MultiSelect';
import { ContextMenu } from '../workspaces/wsUi';
import { fmtKeys } from '../../lib/keys';
import { NEW_DRAFT_FONTS, readNewDraftFont, writeNewDraftFont, type NewDraftFont } from './view';

const TEMPLATE_ICON: Record<TemplateId, typeof FileText> = {
  vide: FileText,
  dissertation: ScrollText,
  explication: BookOpenText,
  fiche: NotebookPen,
};
const KEY_ICON: Record<TemplateKey, typeof FileText> = { ...TEMPLATE_ICON, universitaire: GraduationCap };

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function NewDraftButton({ primary = true }: { primary?: boolean }) {
  const pop = usePop();
  const navigate = useStore((s) => s.navigate);
  const [busy, setBusy] = useState(false);
  const [font, setFont] = useState<NewDraftFont>(readNewDraftFont);
  // réglage relu à chaque ouverture (enregistré dans les réglages de l'app)
  useEffect(() => {
    if (pop.isOpen) setFont(readNewDraftFont());
  }, [pop.isOpen]);
  const create = async (key: TemplateKey) => {
    pop.close();
    setBusy(true);
    try {
      const d = await createFromTemplateImpl(key);
      navigate({ name: 'write', draftId: d.id });
    } catch (e) {
      console.error(e);
      useStore.getState().toast('Impossible de créer l’écrit', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`btn ${primary ? 'btn-primary' : ''}`} disabled={busy} onClick={(e) => pop.toggle(e.currentTarget)} aria-haspopup="menu">
        <Plus size={15} /> Nouveau <ChevronDown size={14} style={{ marginRight: -4, opacity: 0.7 }} />
      </button>
      <Popover pop={pop} label="Modèles" className="ed-tpl-menu">
        <div className="ed-pop-title">Choisir un modèle</div>
        {TEMPLATES.map((t) => {
          const Icon = KEY_ICON[t.key];
          return (
            <button key={t.key} className="ed-tpl-item" onClick={() => create(t.key)} data-template={t.key}>
              <span className="ed-tpl-icon">
                <Icon size={16} />
              </span>
              <span className="ed-tpl-text">
                <strong>{t.label}</strong>
                <span>{t.description}</span>
              </span>
            </button>
          );
        })}
        <label className="ed-tpl-font" title="Police du modèle « Vide » et des écrits créés sans modèle (12 pt, interligne 1,5). Les autres modèles gardent leur police.">
          <span>Police des nouveaux écrits</span>
          <select className="input ed-select" value={font} onChange={(e) => (writeNewDraftFont(e.target.value as NewDraftFont), setFont(e.target.value as NewDraftFont))} data-new-font="">
            {NEW_DRAFT_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </Popover>
    </>
  );
}

export function OpenDocxButton({ className = 'btn btn-ghost' }: { className?: string }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <button
      className={className}
      onClick={async () => {
        const d = await openDocxFromDiskImpl();
        if (d) navigate({ name: 'write', draftId: d.id });
      }}
    >
      <FolderOpen size={15} /> Ouvrir un .docx…
    </button>
  );
}

interface CardSel {
  selected: boolean;
  showCheck: boolean;
  /** Clic avec modificateurs (ou en mode « Sélectionner ») : true si traité par la sélection. */
  click(e: ClickMods): boolean;
  toggle(): void;
  onContextMenu(e: ReactMouseEvent): void;
}

function DraftCard({ draft, index, sel }: { draft: Draft; index: number; sel: CardSel }) {
  const navigate = useStore((s) => s.navigate);
  const patch = useStore((s) => s.patch);
  const menu = usePop();
  const confirm = usePop();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(draft.title);
  const Icon = TEMPLATE_ICON[draft.template ?? 'vide'] ?? FileText;

  const commit = () => {
    const t = name.trim();
    if (t && t !== draft.title) patch('drafts', draft.id, { title: t });
    setName(t || draft.title);
    setRenaming(false);
  };
  const remove = async () => {
    confirm.close();
    // L'écrit part dans la corbeille (30 jours) : ses fichiers, dont la copie de sauvegarde
    // document.prev.docx, restent sur le disque pour pouvoir le restaurer.
    setExternalDirty(draft.id, false);
    // (la corbeille affiche elle-même la confirmation, avec « Annuler »)
    await useStore.getState().removeDraft(draft.id);
  };

  return (
    <article
      className={`ed-card lift ${sel.selected ? 'selected' : ''}`}
      data-draft={draft.id}
      data-sel-id={draft.id}
      role="option"
      aria-selected={sel.selected}
      style={{ '--i': index } as CSSProperties}
      onContextMenu={sel.onContextMenu}
    >
      {sel.showCheck && (
        <span className="ed-card-check">
          <SelectCheck checked={sel.selected} onToggle={sel.toggle} label={`Sélectionner « ${draft.title} »`} />
        </span>
      )}
      <button
        className="ed-card-open"
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={(e) => {
          if (renaming) return;
          // Clavier (Entrée) : detail = 0 ; les modificateurs restent ceux de l'évènement.
          if (sel.click(e)) return;
          navigate({ name: 'write', draftId: draft.id });
        }}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            sel.click({ metaKey: !e.shiftKey, shiftKey: e.shiftKey });
          }
        }}
        aria-label={`Ouvrir ${draft.title}`}
      >
        <div className="ed-thumb" aria-hidden>
          <div className="ed-thumb-page">
            <Icon size={18} className="ed-thumb-icon" />
            <i style={{ width: '62%' }} />
            <i />
            <i />
            <i style={{ width: '80%' }} />
            <i />
            <i style={{ width: '45%' }} />
          </div>
        </div>
      </button>
      <div className="ed-card-body">
        {renaming ? (
          <input
            className="input ed-card-rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setName(draft.title);
                setRenaming(false);
              }
            }}
            aria-label="Nouveau titre"
          />
        ) : (
          <h3 className="ed-card-title truncate" title={draft.title} onDoubleClick={() => setRenaming(true)}>
            {draft.title}
          </h3>
        )}
        <div className="ed-card-meta">
          <span>
            {words(draft.wordCount)}
          </span>
          <span aria-hidden>·</span>
          <span>{relativeTime(draft.updatedAt)}</span>
        </div>
        {draft.externalPath && (
          <div className="ed-card-ext truncate" title={draft.externalPath}>
            <FileText size={12} /> {baseName(draft.externalPath)}
          </div>
        )}
      </div>
      <button className={`icon-btn sm ed-card-menu ${menu.isOpen ? 'active' : ''}`} aria-label="Actions" onClick={(e) => menu.toggle(e.currentTarget)}>
        <MoreHorizontal size={15} />
      </button>
      <Popover pop={menu} label="Actions" className="ed-menu">
        <button
          className="menu-item"
          onClick={() => {
            menu.close();
            setRenaming(true);
          }}
        >
          <Pencil size={14} /> Renommer
        </button>
        <div className="divider" />
        <button
          className="menu-item ed-danger"
          onClick={() => {
            const el = menu.anchorEl;
            menu.close();
            if (el) confirm.open(el);
          }}
        >
          <Trash2 size={14} /> Supprimer…
        </button>
      </Popover>
      <Popover pop={confirm} label="Confirmer la suppression" className="ed-confirm">
        <p className="ed-confirm-q">Supprimer « {draft.title} » ?</p>
        <p className="ed-confirm-note">
          {draft.externalPath
            ? 'L’écrit ira dans la corbeille, où vous pourrez le restaurer pendant 30 jours. Le fichier d’origine sur le disque n’est pas touché.'
            : 'L’écrit ira dans la corbeille, où vous pourrez le restaurer pendant 30 jours.'}
        </p>
        <div className="ed-confirm-actions">
          <button className="btn btn-sm" onClick={confirm.close}>
            Annuler
          </button>
          <button className="btn btn-sm ed-btn-danger" onClick={remove} autoFocus>
            Supprimer
          </button>
        </div>
      </Popover>
    </article>
  );
}

export function DraftList() {
  const drafts = useStore(useShallow((s) => [...s.drafts].sort((a, b) => b.updatedAt - a.updatedAt)));
  // Sélection multiple (⌘-clic, ⇧-clic, ⌘A, lasso, mode « Sélectionner »)
  const ids = useMemo(() => drafts.map((d) => d.id), [drafts]);
  const sel = useMultiSelect(ids);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lasso = useLasso({ container: scrollRef, sel });
  const [selectMode, setSelectMode] = useState(false);
  const [multiMenu, setMultiMenu] = useState<{ x: number; y: number } | null>(null);
  const [addIds, setAddIds] = useState<string[] | null>(null);
  useSelectionKeys(sel, { onEscape: selectMode ? () => setSelectMode(false) : undefined });
  const exitSelect = () => {
    sel.clear();
    setSelectMode(false);
  };
  const showChecks = selectMode || sel.size > 0;
  const removeMany = (list: string[]) => {
    for (const id of list) setExternalDirty(id, false);
    // Un seul toast « N écrits placés dans la corbeille — Annuler » qui remet tout.
    useStore.getState().trashDeleteMany('draft', list);
  };
  const cardSel = (d: Draft): CardSel => ({
    selected: sel.has(d.id),
    showCheck: showChecks,
    click: (e) => sel.click(d.id, e, { toggle: selectMode }),
    toggle: () => sel.toggle(d.id),
    onContextMenu: (e) => {
      if (sel.has(d.id) && sel.size > 1) {
        e.preventDefault();
        setMultiMenu({ x: e.clientX, y: e.clientY });
      } else if (sel.size && !sel.has(d.id)) sel.clear();
    },
  });

  return (
    <div className="ed-list msel-host">
      <header className="topbar">
        <div className="spacer" />
        {drafts.length > 0 && (
          <button
            className={`btn btn-ghost msel-toggle ${selectMode ? 'active' : ''}`}
            aria-pressed={selectMode}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            title={fmtKeys(selectMode ? 'Quitter la sélection (Échap)' : 'Sélectionner plusieurs écrits (⌘-clic, ⇧-clic, ⌘A)')}
          >
            <CheckSquare size={14} /> {selectMode ? 'Terminé' : 'Sélectionner'}
          </button>
        )}
        <OpenDocxButton />
        <NewDraftButton />
      </header>
      <div className="ed-list-scroll" ref={scrollRef} onMouseDown={lasso.onMouseDown}>
        <div className="ed-list-inner anim-view">
          <div className="ed-list-head">
            <h1 className="page-title">Écrits</h1>
            <p className="muted">
              {drafts.length
                ? `${drafts.length} écrit${drafts.length > 1 ? 's' : ''}, enregistré${drafts.length > 1 ? 's' : ''} au format Word (.docx)`
                : 'Dissertations, explications de texte et fiches de lecture, au format Word (.docx).'}
            </p>
          </div>
          {drafts.length === 0 ? (
            <div className="empty ed-empty anim-in">
              <div className="ed-empty-art" aria-hidden>
                <div className="ed-thumb-page">
                  <ScrollText size={20} className="ed-thumb-icon" />
                  <i style={{ width: '62%' }} />
                  <i />
                  <i style={{ width: '80%' }} />
                  <i />
                </div>
              </div>
              <h3>Aucun écrit pour l’instant</h3>
              <p>Partez d’un modèle de dissertation, d’explication de texte ou de fiche de lecture, ou ouvrez un fichier Word existant.</p>
              <div className="ed-empty-actions">
                <NewDraftButton />
                <OpenDocxButton className="btn" />
              </div>
            </div>
          ) : (
            <div className={`ed-grid anim-stagger ${showChecks ? 'ed-selecting' : ''}`} role="listbox" aria-multiselectable="true" aria-label="Écrits">
              {drafts.map((d, i) => (
                <DraftCard key={d.id} draft={d} index={i} sel={cardSel(d)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {lasso.box && <LassoBox box={lasso.box} />}
      <SelectionActionBar count={sel.size} label={sel.size > 1 ? 'écrits sélectionnés' : 'écrit sélectionné'} onClear={exitSelect}>
        <button className="btn btn-ghost btn-sm" onClick={() => setAddIds(sel.ids)}>
          <FolderPlus size={14} /> Ajouter à un espace…
        </button>
        <button className="btn btn-ghost btn-sm msel-danger" onClick={() => removeMany(sel.ids)}>
          <Trash2 size={14} /> Supprimer
        </button>
      </SelectionActionBar>
      {multiMenu && sel.size > 1 && (
        <ContextMenu
          x={multiMenu.x}
          y={multiMenu.y}
          label={`${sel.size} écrits sélectionnés`}
          onClose={() => setMultiMenu(null)}
          entries={[
            { label: 'Ajouter à un espace…', icon: <FolderPlus size={14} />, onClick: () => setAddIds(sel.ids) },
            { sep: true },
            { label: `Supprimer ${sel.size} écrits`, icon: <Trash2 size={14} />, danger: true, onClick: () => removeMany(sel.ids) },
          ]}
        />
      )}
      {addIds && <AddToWorkspaceDialog kind="draft" refIds={addIds} onClose={() => setAddIds(null)} />}
    </div>
  );
}
