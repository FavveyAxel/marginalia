// Panneau « Versions » de l'éditeur : liste chronologique, création d'une version nommée,
// comparaison mot à mot avec l'état actuel (ajouts en vert, suppressions barrées en rouge),
// aperçu, restauration (annulable) et restauration comme nouvel écrit.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bookmark, Copy, History, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Draft, DraftVersion } from '../../lib/types';
import { Kbd, Skeleton } from '../../components/ui';
import type { Block, DocModel } from './docx';
import { fmtInt, words } from './save';
import {
  computeDiff,
  dayLabel,
  defaultVersionName,
  deleteVersion,
  fmtTime,
  fullDate,
  readContent,
  readVersion,
  renameVersion,
  versionTitle,
  type DiffResult,
  type VersionContent,
} from './versions';
import './versions.css';
import { fmtKeys } from '../../lib/keys';

export interface VersionsPanelProps {
  draft: Draft;
  /** .docx de l'état actuel de l'éditeur. */
  currentDocx: () => Promise<ArrayBuffer>;
  /** Crée une version nommée de l'état actuel. */
  createVersion: (name: string) => Promise<DraftVersion | null>;
  /** Restaure la version (après en avoir créé une de l'état actuel). */
  restore: (v: DraftVersion, data: ArrayBuffer) => Promise<boolean>;
  /** Copie la version dans un nouvel écrit. */
  restoreAsNew: (v: DraftVersion, data: ArrayBuffer) => Promise<void>;
  /** Change à chaque ⌘⌥S : ouvre le champ « Créer une version… ». */
  createNonce: number;
  editable: boolean;
  onClose: () => void;
}

type View = 'diff' | 'preview';

export function VersionsPanel({ draft, currentDocx, createVersion, restore, restoreAsNew, createNonce, editable, onClose }: VersionsPanelProps) {
  const toast = useStore((s) => s.toast);
  const versions = useMemo(() => [...(draft.versions ?? [])].sort((a, b) => b.createdAt - a.createdAt), [draft.versions]);
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createNonce > 0) setNaming(defaultVersionName());
  }, [createNonce]);
  useEffect(() => {
    if (naming !== null)
      requestAnimationFrame(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      });
  }, [naming !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = versions.find((v) => v.id === selId) ?? null;
  useEffect(() => {
    if (selId && !selected) setSelId(null);
  }, [selId, selected]);

  const submitName = async () => {
    if (naming === null || busy) return;
    const name = naming.trim() || defaultVersionName();
    setBusy(true);
    try {
      const v = await createVersion(name);
      if (v) {
        toast(`Version « ${versionTitle(v)} » créée`, 'success');
        setNaming(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const out: { day: string; items: DraftVersion[] }[] = [];
    for (const v of versions) {
      const day = dayLabel(v.createdAt);
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(v);
      else out.push({ day, items: [v] });
    }
    return out;
  }, [versions]);

  return (
    <>
      <aside className="ed-extracts ed-versions panel anim-slide" aria-label="Versions">
        <div className="ed-extracts-head">
          <h2>Versions</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer le panneau des versions">
            <X size={15} />
          </button>
        </div>
        <div className="ver-create">
          {naming === null ? (
            <button className="btn ver-create-btn" onClick={() => setNaming(defaultVersionName())} disabled={!editable} title={fmtKeys("Créer une version nommée de l’état actuel (⌘⌥S)")}>
              <Plus size={14} /> Créer une version… <Kbd>⌘⌥S</Kbd>
            </button>
          ) : (
            <form
              className="ver-create-form anim-fade"
              onSubmit={(e) => {
                e.preventDefault();
                void submitName();
              }}
            >
              <label className="ver-label" htmlFor="ver-name">
                Nom de la version
              </label>
              <input
                id="ver-name"
                ref={nameRef}
                className="input"
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setNaming(null);
                  }
                }}
                maxLength={120}
                spellCheck={false}
              />
              <div className="ver-create-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNaming(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                  {busy ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          )}
        </div>
        <div className="ed-extracts-list ver-list" role="list">
          {versions.length === 0 ? (
            <div className="ed-extracts-empty">
              <History size={20} style={{ margin: '0 auto 4px', opacity: 0.6 }} />
              <strong>Pas encore de version</strong>
              <span>Marginalia garde une version toutes les dix minutes d’écriture et à chaque fermeture. Nommez une étape importante avec « Créer une version… ».</span>
            </div>
          ) : (
            groups.map((g) => (
              <Fragment key={g.day}>
                <div className="ver-day">{g.day}</div>
                {g.items.map((v) => {
                  const delta = v.wordCount - draft.wordCount;
                  return (
                    <div
                      key={v.id}
                      role="listitem"
                      className={`ver-item ${v.id === selId ? 'active' : ''} ${v.name ? 'named' : ''}`}
                      data-version={v.id}
                      data-kind={v.kind}
                    >
                      {renaming?.id === v.id ? (
                        <form
                          className="ver-rename"
                          onSubmit={(e) => {
                            e.preventDefault();
                            renameVersion(draft.id, v.id, renaming.name);
                            setRenaming(null);
                          }}
                        >
                          <input
                            className="input"
                            autoFocus
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                            onBlur={() => {
                              renameVersion(draft.id, v.id, renaming.name);
                              setRenaming(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setRenaming(null);
                              }
                            }}
                            aria-label="Nom de la version"
                            maxLength={120}
                          />
                        </form>
                      ) : (
                        <button className="ver-item-main" onClick={() => setSelId(v.id === selId ? null : v.id)} aria-pressed={v.id === selId}>
                          <span className="ver-time">{fmtTime(v.createdAt)}</span>
                          <span className="ver-name">
                            {v.name && <Bookmark size={11} className="ver-flag" />}
                            <span className="truncate">{versionTitle(v)}</span>
                          </span>
                          <span className="ver-meta">
                            {words(v.wordCount)}
                            {delta !== 0 && (
                              <span className="ver-delta" title={`${words(Math.abs(delta))} de ${delta > 0 ? 'plus' : 'moins'} que l’état actuel`}>
                                {delta > 0 ? '+' : '−'}
                                {fmtInt(Math.abs(delta))}
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                      <div className="ver-item-actions">
                        <button className="icon-btn sm" title={v.name ? 'Renommer' : 'Nommer (la version sera conservée)'} aria-label="Renommer la version" onClick={() => setRenaming({ id: v.id, name: v.name ?? defaultVersionName(v.createdAt) })}>
                          <Pencil size={12} />
                        </button>
                        <button
                          className="icon-btn sm"
                          title="Supprimer cette version"
                          aria-label="Supprimer la version"
                          onClick={() => {
                            if (selId === v.id) setSelId(null);
                            void deleteVersion(draft.id, v.id).then(() => toast('Version supprimée', 'info'));
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            ))
          )}
        </div>
      </aside>
      {selected && (
        <Compare
          key={selected.id}
          draft={draft}
          version={selected}
          currentDocx={currentDocx}
          editable={editable}
          onClose={() => setSelId(null)}
          restore={async (data) => {
            const ok = await restore(selected, data);
            if (ok) setSelId(null);
          }}
          restoreAsNew={(data) => restoreAsNew(selected, data)}
        />
      )}
    </>
  );
}

// ── Comparaison / aperçu ─────────────────────────────────────
function Compare({
  draft,
  version,
  currentDocx,
  editable,
  onClose,
  restore,
  restoreAsNew,
}: {
  draft: Draft;
  version: DraftVersion;
  currentDocx: () => Promise<ArrayBuffer>;
  editable: boolean;
  onClose: () => void;
  restore: (data: ArrayBuffer) => Promise<void>;
  restoreAsNew: (data: ArrayBuffer) => Promise<void>;
}) {
  const [view, setView] = useState<View>('diff');
  const [state, setState] = useState<{ data: ArrayBuffer; old: VersionContent; diff: DiffResult | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await readVersion(draft.id, version);
      const [old, cur] = await Promise.all([readContent(data.slice(0)), currentDocx().then(readContent)]);
      if (cancelled) return;
      // Le calcul peut prendre un instant sur un long texte : on laisse d'abord s'afficher le squelette.
      await new Promise((r) => setTimeout(r, 0));
      const diff = computeDiff(old.text, cur.text);
      if (!cancelled) setState({ data, old, diff });
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setError('Cette version est illisible ou son fichier est introuvable.');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, version.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changes = () => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('.ver-diff ins, .ver-diff del') ?? []);
  const go = (dir: 1 | -1) => {
    const list = changes();
    if (!list.length) return;
    const next = (cursor + dir + list.length) % list.length;
    setCursor(next);
    list.forEach((el) => el.classList.remove('ver-focus'));
    list[next].classList.add('ver-focus');
    list[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const identical = !!state?.diff && state.diff.added === 0 && state.diff.removed === 0 && state.diff.parts.every((p) => !p.added && !p.removed);

  return (
    <section className="ver-compare panel anim-in" aria-label={`Version : ${versionTitle(version)}`} data-version={version.id}>
      <header className="ver-compare-head">
        <div className="ver-compare-title">
          <h3>{versionTitle(version)}</h3>
          <span>
            {fullDate(version.createdAt)} · {words(version.wordCount)}
          </span>
        </div>
        <div className="ver-seg" role="tablist" aria-label="Affichage">
          <button role="tab" aria-selected={view === 'diff'} className={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}>
            Différences
          </button>
          <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>
            Aperçu
          </button>
        </div>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer la comparaison">
          <X size={15} />
        </button>
      </header>
      {view === 'diff' && state?.diff && !identical && (
        <div className="ver-legend anim-fade">
          <span className="ver-legend-item">
            <ins>ajouté</ins> depuis cette version : {words(state.diff.added)}
          </span>
          <span className="ver-legend-item">
            <del>supprimé</del> : {words(state.diff.removed)}
          </span>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={() => go(-1)} title="Différence précédente" aria-label="Différence précédente">
            <ArrowUp size={14} />
          </button>
          <button className="icon-btn sm" onClick={() => go(1)} title="Différence suivante" aria-label="Différence suivante">
            <ArrowDown size={14} />
          </button>
        </div>
      )}
      <div className="ver-compare-body" ref={bodyRef}>
        {error ? (
          <div className="ed-extracts-empty">
            <strong>Version indisponible</strong>
            <span>{error}</span>
          </div>
        ) : !state ? (
          <div className="ver-paper" aria-busy="true">
            <Skeleton lines={8} />
          </div>
        ) : view === 'preview' ? (
          <div className="ver-paper ver-preview">
            <Preview model={state.old.model} />
          </div>
        ) : !state.diff ? (
          <div className="ed-extracts-empty">
            <strong>Trop de différences pour les afficher</strong>
            <span>Les deux textes diffèrent trop pour une comparaison mot à mot. Consultez l’aperçu.</span>
          </div>
        ) : identical ? (
          <div className="ed-extracts-empty ver-same">
            <strong>Aucune différence de texte</strong>
            <span>Cette version a le même texte que l’état actuel (la mise en forme peut différer).</span>
          </div>
        ) : (
          <div className="ver-paper ver-diff" data-added={state.diff.added} data-removed={state.diff.removed}>
            {state.diff.parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
          </div>
        )}
      </div>
      <footer className="ver-compare-foot">
        <span className="ver-hint">L’état actuel est gardé en version avant de restaurer.</span>
        <button className="btn" disabled={!state || busy} onClick={() => state && void restoreAsNew(state.data)} data-act="restore-new">
          <Copy size={14} /> Restaurer comme nouvel écrit
        </button>
        <button
          className="btn btn-primary"
          disabled={!state || busy || !editable}
          data-act="restore"
          onClick={async () => {
            if (!state) return;
            setBusy(true);
            try {
              await restore(state.data);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RotateCcw size={14} /> {busy ? 'Restauration…' : 'Restaurer'}
        </button>
      </footer>
    </section>
  );
}

function Preview({ model }: { model: DocModel }) {
  if (!model.blocks.length) return <p className="ver-empty-doc">Document vide.</p>;
  return (
    <>
      {model.blocks.map((b, i) => (
        <PreviewBlock key={i} b={b} />
      ))}
    </>
  );
}

function PreviewBlock({ b }: { b: Block }) {
  const content = b.inlines.map((x, i) =>
    x.t === 'text' ? (
      <span key={i} style={{ fontWeight: x.b ? 600 : undefined, fontStyle: x.i ? 'italic' : undefined, textDecoration: x.u ? 'underline' : undefined }}>
        {x.text}
      </span>
    ) : x.t === 'br' ? (
      <br key={i} />
    ) : (
      <sup key={i} className="ver-note">
        *
      </sup>
    ),
  );
  switch (b.kind) {
    case 'title':
      return <h1 className="ver-p-title">{content}</h1>;
    case 'h1':
      return <h2>{content}</h2>;
    case 'h2':
      return <h3>{content}</h3>;
    case 'h3':
    case 'h4':
      return <h4>{content}</h4>;
    case 'quote':
      return <blockquote>{content}</blockquote>;
    case 'li':
      return <p className="ver-li" style={{ paddingLeft: 18 + (b.level ?? 0) * 18 }}>{content}</p>;
    default:
      return <p>{content || ' '}</p>;
  }
}
