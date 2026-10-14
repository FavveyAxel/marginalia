// Liste des écrits (route { name: 'write', draftId: null }).
import { useState, type CSSProperties } from 'react';
import { BookOpenText, ChevronDown, FileText, FolderOpen, MoreHorizontal, NotebookPen, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import type { Draft } from '../../lib/types';
import { relativeTime } from '../../components/ui';
import { createDraftImpl, openDocxFromDiskImpl, PREV_FILE } from './impl';
import { TEMPLATES, templateInfo, type TemplateId } from './templates';
import { Popover, usePop } from './Popover';
import { setExternalDirty, words } from './save';

const TEMPLATE_ICON: Record<TemplateId, typeof FileText> = {
  vide: FileText,
  dissertation: ScrollText,
  explication: BookOpenText,
  fiche: NotebookPen,
};

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function NewDraftButton({ primary = true }: { primary?: boolean }) {
  const pop = usePop();
  const navigate = useStore((s) => s.navigate);
  const [busy, setBusy] = useState(false);
  const create = async (id: TemplateId) => {
    pop.close();
    setBusy(true);
    try {
      const d = await createDraftImpl({ title: templateInfo(id).defaultTitle, template: id });
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
          const Icon = TEMPLATE_ICON[t.id];
          return (
            <button key={t.id} className="ed-tpl-item" onClick={() => create(t.id)}>
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

function DraftCard({ draft, index }: { draft: Draft; index: number }) {
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
    try {
      await host.deleteFile(draft.id, PREV_FILE);
    } catch {
      /* pas de copie */
    }
    setExternalDirty(draft.id, false);
    await useStore.getState().removeDraft(draft.id);
    useStore.getState().toast(`« ${draft.title} » supprimé`);
  };

  return (
    <article className="ed-card lift" data-draft={draft.id} style={{ '--i': index } as CSSProperties}>
      <button className="ed-card-open" onClick={() => !renaming && navigate({ name: 'write', draftId: draft.id })} aria-label={`Ouvrir ${draft.title}`}>
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
            ? 'La copie de travail est effacée de Marginalia. Le fichier d’origine sur le disque n’est pas touché.'
            : 'L’écrit est effacé de Marginalia. Exportez-le d’abord si vous voulez le garder.'}
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
  return (
    <div className="ed-list">
      <header className="topbar">
        <div className="spacer" />
        <OpenDocxButton />
        <NewDraftButton />
      </header>
      <div className="ed-list-scroll">
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
            <div className="ed-grid anim-stagger">
              {drafts.map((d, i) => (
                <DraftCard key={d.id} draft={d} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
