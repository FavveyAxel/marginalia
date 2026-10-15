// 19. Versions de la carte : panneau latéral listant les instantanés (enregistrés à la main ou
// automatiques : avant un rangement, une conversion, une suppression multiple, une restauration).
// « Créer une version… » (nom), aperçu miniature au survol, Restaurer (annulable : toast
// « Annuler » et ⌘Z), Supprimer (toast « Annuler »), double-clic sur le nom pour renommer.
import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { History, Pin, RotateCcw, Trash2, X } from 'lucide-react';
import { useStore } from '../../../lib/store';
import { relativeTime } from '../../../components/ui';
import type { MapVersion } from '../../../lib/types';
import { deleteVersion, renameVersion, restoreVersion, saveVersion } from '../model/actions';
import { mapToSvg } from '../model/svg';
import { VERSION_REASON_LABEL, versionSummary, versionsOf } from '../model/versions';

export function useMapVersions(mapKey: string): MapVersion[] {
  const all = useStore((s) => s.mapVersions);
  return useMemo(() => versionsOf(all, mapKey), [all, mapKey]);
}

export function VersionsPanel({ mapKey, onClose }: { mapKey: string; onClose(): void }) {
  const list = useMapVersions(mapKey);
  const [name, setName] = useState('');
  const [hover, setHover] = useState<{ v: MapVersion; top: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const create = () => {
    const v = saveVersion(mapKey, name);
    setName('');
    useStore.getState().toast(`Version « ${v.name} » enregistrée`, 'success');
  };
  const remove = (v: MapVersion) => {
    deleteVersion(v.id);
    setHover(null);
    useStore.getState().toast(v.name ? `Version « ${v.name} » supprimée` : 'Version supprimée', 'info', {
      label: 'Annuler',
      run: () => {
        const cur = useStore.getState().mapVersions ?? [];
        if (!cur.some((x) => x.id === v.id)) useStore.setState({ mapVersions: [v, ...cur] });
      },
    });
  };
  return (
    <aside className="map-side anim-scale" data-testid="map-versions-panel" aria-label="Versions de la carte">
      <header className="map-side-head">
        <History size={15} className="map-side-ico" />
        <h3>Versions</h3>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer" title="Fermer">
          <X size={14} />
        </button>
      </header>
      <form
        className="map-ver-new"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la version" aria-label="Nom de la nouvelle version" data-testid="version-name" />
        <button className="btn btn-sm btn-primary" type="submit" data-act="version-create">
          Créer une version
        </button>
      </form>
      <p className="map-side-note">Une version est aussi enregistrée d’elle-même avant un rangement automatique, une conversion ou la suppression de plusieurs cartes.</p>
      <div className="map-side-body" ref={body} onMouseLeave={() => setHover(null)}>
        {!list.length && <p className="map-side-none">Aucune version pour l’instant.</p>}
        <ul className="map-ver-list">
          {list.map((v) => (
            <li
              key={v.id}
              className={`map-ver ${v.name ? 'named' : 'auto'}`}
              data-version={v.id}
              onMouseEnter={(e) => {
                const host = body.current?.closest('.map-side')?.getBoundingClientRect();
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ v, top: r.top - (host?.top ?? 0) });
              }}
            >
              <span className={`map-ver-dot ${v.name ? 'named' : ''}`} aria-hidden>
                {v.name ? <Pin size={10} /> : null}
              </span>
              <div className="map-ver-main">
                {renaming === v.id ? (
                  <input
                    className="map-ver-rename"
                    autoFocus
                    defaultValue={v.name ?? ''}
                    aria-label="Nom de la version"
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={(e) => {
                      if (renaming === v.id) renameVersion(v.id, e.target.value);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <b className="truncate" onDoubleClick={() => setRenaming(v.id)} title="Double-clic pour nommer (une version nommée est conservée)">
                    {v.name ?? VERSION_REASON_LABEL[v.reason]}
                  </b>
                )}
                <small>
                  {v.name ? 'Enregistrée' : 'Automatique'} · {relativeTime(v.createdAt).replace(/^Il y a/, 'il y a').replace(/^À l’instant/, 'à l’instant')}
                </small>
                <small className="map-ver-sum">{versionSummary(v).replace(/, /g, ' · ')}</small>
              </div>
              <span className="map-ver-acts">
                <button className="icon-btn sm" data-act="version-restore" title="Restaurer cette version (annulable)" aria-label="Restaurer" onClick={() => restoreVersion(v.id)}>
                  <RotateCcw size={14} />
                </button>
                <button className="icon-btn sm map-danger" data-act="version-delete" title="Supprimer cette version" aria-label="Supprimer" onClick={() => remove(v)}>
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {hover && <Preview v={hover.v} top={hover.top} />}
    </aside>
  );
}

/** Miniature de la version (SVG du modèle), à gauche du panneau. */
function Preview({ v, top }: { v: MapVersion; top: number }) {
  const { highlights, books } = useStore(useShallow((s) => ({ highlights: s.highlights, books: s.books })));
  const src = useMemo(() => {
    const r = mapToSvg(v.map, { highlights, books }, { padding: 24 });
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
  }, [v, highlights, books]);
  return (
    <div className="map-ver-preview anim-fade" style={{ top: Math.max(8, top - 30) }} data-testid="version-preview" aria-hidden>
      <img src={src} alt="" />
      <span>{v.name ?? VERSION_REASON_LABEL[v.reason]}</span>
    </div>
  );
}
