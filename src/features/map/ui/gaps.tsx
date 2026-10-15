// 15. Signaux de manques : pastille discrète dans la barre de la carte (« 3 points à revoir »)
// et panneau latéral qui les détaille (thèse sans argument, objection sans réponse, extraits
// catégorisés pas encore placés, cartes isolées). Un clic sur une carte la centre et la met en
// évidence ; « Placer » ajoute les extraits manquants. Option « Afficher les signaux » : petite
// marque sur les cartes concernées (classe map-gap-* sur le nœud React Flow).
import { useMemo, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CircleAlert, Crosshair, Plus, X } from 'lucide-react';
import { useStore } from '../../../lib/store';
import { kindColor, kindLabel } from '../../../lib/categories';
import type { ArgumentMap, Highlight } from '../../../lib/types';
import { gapMessages, mapGaps, type GapMessage, type MapGaps } from '../model/gaps';

/** Signaux de la carte, recalculés quand elle (ou les extraits) change. */
export function useMapGaps(map: ArgumentMap): { gaps: MapGaps; messages: GapMessage[] } {
  const { highlights, books, studies } = useStore(useShallow((s) => ({ highlights: s.highlights, books: s.books, studies: s.studies })));
  return useMemo(() => {
    const gaps = mapGaps(map, { highlights, books, studies });
    return { gaps, messages: gapMessages(gaps) };
  }, [map, highlights, books, studies]);
}

/** Classe de marque par carte (première raison trouvée). */
export function gapMarks(gaps: MapGaps): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of gaps.thesesWithoutArgument) out.set(id, 'map-gap map-gap-these');
  for (const id of gaps.objectionsWithoutAnswer) if (!out.has(id)) out.set(id, 'map-gap map-gap-objection');
  for (const id of gaps.isolated) if (!out.has(id)) out.set(id, 'map-gap map-gap-isolated');
  return out;
}

const pointsLabel = (n: number) => `${n} point${n > 1 ? 's' : ''} à revoir`;

/** Pastille de la barre d'outils (rien quand tout va bien). */
export function GapsPill({ total, open, onClick }: { total: number; open: boolean; onClick(): void }) {
  if (!total) return null;
  return (
    <button className={`map-gaps-pill ${open ? 'on' : ''}`} data-act="gaps" aria-pressed={open} onClick={onClick} title="Ce qui manque peut-être à la carte">
      <i aria-hidden />
      {pointsLabel(total)}
    </button>
  );
}

const HINT: Record<GapMessage['kind'], string> = {
  these: 'Aucun lien « soutient » n’arrive sur cette thèse.',
  objection: 'Aucun lien « répond à » ne vise cette objection.',
  unplaced: 'Extraits classés (thèse, argument…) qui ne figurent pas encore sur la carte.',
  isolated: 'Cartes reliées à rien.',
};

export function GapsPanel({
  messages,
  total,
  marks,
  titleOf,
  onToggleMarks,
  onFocus,
  onPlace,
  onClose,
}: {
  messages: GapMessage[];
  total: number;
  marks: boolean;
  titleOf(nodeId: string): string;
  onToggleMarks(): void;
  onFocus(nodeId: string): void;
  onPlace(highlightIds: string[]): void;
  onClose(): void;
}) {
  const all = useStore((s) => s.highlights);
  const byId = useMemo(() => new Map(all.map((h) => [h.id, h])), [all]);
  return (
    <aside className="map-side anim-scale" data-testid="map-gaps-panel" aria-label="Points à revoir">
      <header className="map-side-head">
        <CircleAlert size={15} className="map-side-ico warn" />
        <h3>{total ? pointsLabel(total) : 'Rien à signaler'}</h3>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer" title="Fermer">
          <X size={14} />
        </button>
      </header>
      <label className="map-side-switch">
        <input type="checkbox" checked={marks} onChange={onToggleMarks} data-act="gap-marks" />
        <span>Afficher les signaux sur les cartes</span>
      </label>
      <div className="map-side-body">
        {!messages.length && <p className="map-side-none">La carte ne présente aucun manque évident : chaque thèse est soutenue, chaque objection reçoit une réponse.</p>}
        {messages.map((m) => (
          <section key={m.kind} className="map-gap-group" data-gap={m.kind}>
            <h4>
              <span className={`map-gap-dot k-${m.kind}`} />
              {m.text}
            </h4>
            <p className="map-gap-hint">{HINT[m.kind]}</p>
            {m.kind === 'unplaced' ? (
              <Unplaced ids={m.highlightIds} byId={byId} onPlace={onPlace} />
            ) : (
              <ul>
                {m.nodeIds.map((id) => (
                  <li key={id}>
                    <button className="map-gap-item" data-node={id} onClick={() => onFocus(id)} title="Centrer sur la carte">
                      <span className="truncate">{titleOf(id)}</span>
                      <Crosshair size={13} className="map-gap-go" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </aside>
  );
}

const MAX_SHOWN = 12;

function Unplaced({ ids, byId, onPlace }: { ids: string[]; byId: Map<string, Highlight>; onPlace(ids: string[]): void }) {
  const list = ids.map((id) => byId.get(id)).filter(Boolean) as Highlight[];
  return (
    <>
      <ul>
        {list.slice(0, MAX_SHOWN).map((h) => (
          <li key={h.id} className="map-gap-hl" style={{ '--c': kindColor(h) } as CSSProperties}>
            <div className="body">
              <span className="cat">{kindLabel(h)}</span>
              <p>{h.text.replace(/\s+/g, ' ').trim()}</p>
            </div>
            <button className="btn btn-sm map-gap-place" data-act="gap-place" data-hl={h.id} onClick={() => onPlace([h.id])}>
              <Plus size={13} /> Placer
            </button>
          </li>
        ))}
      </ul>
      {list.length > 1 && (
        <button className="btn btn-sm map-gap-all" data-act="gap-place-all" onClick={() => onPlace(list.map((h) => h.id))}>
          <Plus size={13} /> Placer les {list.length}
        </button>
      )}
    </>
  );
}
