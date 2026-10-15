// Centre de la carte (problématique ou sujet) : la carte du centre et ses entrées de menu.
// Modèle : model/center.ts. Une problématique est une question (« ? » en médaillon) ; un sujet,
// un thème (anneau). Texte centré, serif de lecture, plus grand que les autres cartes.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { NodeProps } from '@xyflow/react';
import { CircleHelp, Crosshair, Lightbulb, Orbit } from 'lucide-react';
import type { MenuEntry } from '../../workspaces/wsUi';
import { CENTER_LABEL, CENTER_PLACEHOLDER, type CenterKind } from '../model/center';
import { useMapCtx } from './ctx';
import { Handles } from './nodes';
import { FoldToggle, type FoldData } from './fold';

export interface CenterData extends Record<string, unknown> {
  text: string;
  kind: CenterKind;
  fold?: FoldData;
}

/** Teinte du centre : celle de sa relation (« répond à » orangé, « se rattache à » bleu-vert). */
export const CENTER_TINT: Record<CenterKind, string> = { question: 'var(--rel-repond)', subject: 'var(--rel-rattache)' };
/** Largeur du centre (voir .map-center dans map.css). */
export const CENTER_W = 380;

export function CenterNode({ id, data, selected }: NodeProps) {
  const ctx = useMapCtx();
  const d = data as CenterData;
  const kind: CenterKind = d.kind === 'subject' ? 'subject' : 'question';
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
    if (draft.trim() !== text) ctx.setIdeaText(id, draft.replace(/\s+/g, ' ').trim());
  };
  return (
    <div
      className={`map-node map-center ${editing ? 'editing' : ''} ${selected ? 'sel' : ''}`}
      style={{ '--c': CENTER_TINT[kind] } as CSSProperties}
      data-center={kind}
      onDoubleClick={() => ctx.setEditingId(id)}
    >
      <span className="map-center-mark" aria-hidden>
        {kind === 'question' ? '?' : <i />}
      </span>
      <div className="map-center-label">{CENTER_LABEL[kind]}</div>
      {editing ? (
        <textarea
          ref={ta}
          className="map-center-input nodrag nowheel nopan"
          autoFocus
          rows={1}
          value={draft}
          placeholder={CENTER_PLACEHOLDER[kind]}
          aria-label={CENTER_LABEL[kind]}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onBlur={done}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault();
              done();
            } else if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              closing.current = true;
              ctx.editTab(id, draft.replace(/\s+/g, ' ').trim());
            }
          }}
        />
      ) : (
        <p className={`map-center-text ${text ? '' : 'placeholder'}`}>{text || CENTER_PLACEHOLDER[kind]}</p>
      )}
      <Handles />
      <FoldToggle fold={d.fold} />
    </div>
  );
}

/** « Poser la problématique » / « Poser le sujet » (barre, menu du vide, carte vide). */
export function poseCenterEntries(onPose: (kind: CenterKind) => void, suffix = ''): MenuEntry[] {
  return [
    { label: `Poser la problématique${suffix}`, icon: <CircleHelp size={14} />, hint: 'une question', onClick: () => onPose('question') },
    { label: `Poser le sujet${suffix}`, icon: <Orbit size={14} />, hint: 'un thème', onClick: () => onPose('subject') },
  ];
}

/** Menu « Centre » de la barre : poser le centre, ou y aller / en changer la nature. */
export function centerBarEntries(center: { id: string; kind?: CenterKind } | null, act: { pose(kind: CenterKind): void; goto(id: string): void; convert(id: string, kind: CenterKind | null): void }): MenuEntry[] {
  if (!center) return poseCenterEntries(act.pose);
  const other: CenterKind = center.kind === 'question' ? 'subject' : 'question';
  return [
    { label: center.kind === 'question' ? 'Aller à la problématique' : 'Aller au sujet', icon: <Crosshair size={14} />, onClick: () => act.goto(center.id) },
    { label: other === 'question' ? 'En faire une problématique' : 'En faire un sujet', icon: other === 'question' ? <CircleHelp size={14} /> : <Orbit size={14} />, onClick: () => act.convert(center.id, other) },
  ];
}

/** Menu d'une idée : en faire le centre, ou (centre) changer de nature / redevenir une idée. */
export function centerNodeEntries(node: { id: string; kind?: CenterKind; highlightId: string | null }, convert: (id: string, kind: CenterKind | null) => void): MenuEntry[] {
  if (node.highlightId) return [];
  if (node.kind === 'question')
    return [
      { label: 'En faire le sujet', icon: <Orbit size={14} />, onClick: () => convert(node.id, 'subject') },
      { label: 'Redevenir une idée', icon: <Lightbulb size={14} />, onClick: () => convert(node.id, null) },
    ];
  if (node.kind === 'subject')
    return [
      { label: 'En faire la problématique', icon: <CircleHelp size={14} />, onClick: () => convert(node.id, 'question') },
      { label: 'Redevenir une idée', icon: <Lightbulb size={14} />, onClick: () => convert(node.id, null) },
    ];
  return [
    { label: 'Faire de cette idée la problématique', icon: <CircleHelp size={14} />, onClick: () => convert(node.id, 'question') },
    { label: 'Faire de cette idée le sujet', icon: <Orbit size={14} />, onClick: () => convert(node.id, 'subject') },
  ];
}
