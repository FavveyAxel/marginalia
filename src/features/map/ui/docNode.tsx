// Carte-document (nœud React Flow) : écrit, livre, vidéo, image ou plan, affiché d'après l'original.
// Double-clic ou « Ouvrir » : l'original. Original supprimé : la carte le dit au lieu de disparaître.
import { useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowRight, BookOpen, FilePen, Image as ImageIcon, ListTree, MonitorPlay, Unlink } from 'lucide-react';
import { separateUndoStep, uid, useStore } from '../../../lib/store';
import type { MapDocRef } from '../../../lib/types';
import { BookCover } from '../../library/BookCover';
import { VideoThumb, watchedLabel } from '../../video/VideoCover';
import { STATUSES, statusCounts } from '../../plans/planLink';
import '../../plans/status.css';
import { docNode, docTarget, placedDocs, type DocKindLabel, type DocTarget } from '../model/docs';
import { lookup, updateMap } from '../model/actions';
import { placeNewNodes } from '../model/copy';

export interface DocData extends Record<string, unknown> {
  doc: MapDocRef;
  central: boolean;
}

const ICON: Record<DocKindLabel, JSX.Element> = {
  Écrit: <FilePen size={13} />,
  Livre: <BookOpen size={13} />,
  Vidéo: <MonitorPlay size={13} />,
  Image: <ImageIcon size={13} />,
  Plan: <ListTree size={13} />,
};
const TINT: Record<DocKindLabel, string> = {
  Écrit: 'var(--cat-these)',
  Livre: 'var(--cat-argument)',
  Vidéo: 'var(--cat-objection)',
  Image: 'var(--cat-exemple)',
  Plan: 'var(--cat-concept)',
};

const fmtN = (n: number) => n.toLocaleString('fr-FR');
const plural = (n: number, one: string, many = one + 's') => `${fmtN(n)} ${n > 1 ? many : one}`;

const lkNow = () => {
  const s = useStore.getState();
  return { books: s.books, drafts: s.drafts, plans: s.plans };
};

/** Ouvre l'original d'une carte-document. */
export function openDoc(ref: MapDocRef): boolean {
  const s = useStore.getState();
  const t = docTarget(ref, lkNow());
  if (!t) {
    s.toast('Ce document n’existe plus (voir la corbeille)', 'error');
    return false;
  }
  if (ref.kind === 'draft') s.navigate({ name: 'write', draftId: ref.id });
  else if (ref.kind === 'plan') s.navigate({ name: 'plans', planId: ref.id });
  else s.navigate({ name: 'reader', bookId: ref.id, tab: 'lecture', splitBookId: null });
  return true;
}

/**
 * Pose des cartes-documents sur la carte `key` (dans un coin libre, ou à partir de `at`).
 * Un document déjà posé n'est pas doublé. Renvoie le nombre de cartes posées.
 */
export function addDocs(key: string, refs: MapDocRef[], at?: { x: number; y: number }): number {
  const lk = lkNow();
  separateUndoStep();
  let n = 0;
  updateMap(key, (m) => {
    const have = placedDocs(m.nodes);
    const fresh = refs
      .filter((r, i) => !have.has(`${r.kind}:${r.id}`) && refs.findIndex((x) => x.kind === r.kind && x.id === r.id) === i)
      .map((r, i) => {
        const t = docTarget(r, lk);
        return t ? docNode(r, at ? { x: at.x + i * 28, y: at.y + i * 28 } : { x: 0, y: 0 }, uid(), t.title) : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!fresh.length) return m;
    const placed = at ? fresh : placeNewNodes(m, fresh, lookup());
    n = placed.length;
    return { ...m, nodes: [...m.nodes, ...placed] };
  });
  return n;
}

const sides: [Position, string][] = [
  [Position.Top, 't'],
  [Position.Right, 'r'],
  [Position.Bottom, 'b'],
  [Position.Left, 'l'],
];

function Body({ t }: { t: DocTarget }) {
  if (t.book) {
    const b = t.book;
    if (b.format === 'video')
      return (
        <>
          <div className="map-doc-media">
            <VideoThumb book={b} />
          </div>
          <b className="map-doc-title">{t.title}</b>
          <span className="map-doc-meta">{[b.author, watchedLabel(b)].filter(Boolean).join(' · ')}</span>
        </>
      );
    if (b.format === 'image')
      return (
        <>
          {b.cover ? <img className="map-doc-image" src={b.cover} alt="" draggable={false} /> : <div className="map-doc-image map-doc-image-none" />}
          <b className="map-doc-title">{t.title}</b>
        </>
      );
    return (
      <div className="map-doc-book">
        <BookCover book={b} size="sm" />
        <div>
          <b className="map-doc-title">{t.title}</b>
          {b.author && <span className="map-doc-sub">{b.author}</span>}
          <span className="map-doc-meta">{b.progress > 0 ? `${Math.round(b.progress * 100)} % lu` : 'Pas encore commencé'}</span>
        </div>
      </div>
    );
  }
  if (t.draft) {
    const d = t.draft;
    const heads = (d.outline ?? []).filter((h) => h.level > 1).slice(0, 3);
    return (
      <>
        <b className="map-doc-title">{t.title}</b>
        {heads.length > 0 && (
          <ul className="map-doc-heads">
            {heads.map((h, i) => (
              <li key={i} className={`l${h.level}`}>
                {h.text}
              </li>
            ))}
          </ul>
        )}
        <span className="map-doc-meta">{plural(d.wordCount, 'mot')}</span>
      </>
    );
  }
  const p = t.plan!;
  const c = statusCounts(p);
  const total = c.todo + c.draft + c.review + c.done;
  return (
    <>
      <b className="map-doc-title">{t.title}</b>
      <div className="map-doc-progress" aria-hidden>
        {STATUSES.filter((s) => s.id !== 'todo').map((s) => (c[s.id] ? <i key={s.id} className={`st-${s.id}`} style={{ width: `${(c[s.id] / total) * 100}%` }} /> : null))}
      </div>
      <span className="map-doc-meta">
        {plural(p.parts.length, 'partie')} · {c.done} sur {total} terminée{c.done > 1 ? 's' : ''}
      </span>
    </>
  );
}

export function DocNode({ data, selected }: NodeProps) {
  const d = data as DocData;
  const books = useStore((s) => s.books);
  const drafts = useStore((s) => s.drafts);
  const plans = useStore((s) => s.plans);
  const t = useMemo(() => docTarget(d.doc, { books, drafts, plans }), [d.doc, books, drafts, plans]);
  const open = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    openDoc(d.doc);
  };
  const handles = sides.map(([p, id]) => <Handle key={id} id={id} type="source" position={p} className={`map-h map-h-${id}`} />);
  if (!t)
    return (
      <div className={`map-node map-doc missing ${selected ? 'sel' : ''}`} data-doc={`${d.doc.kind}:${d.doc.id}`} data-testid="doc-node">
        <div className="map-doc-head">
          <Unlink size={13} />
          <span className="map-node-cat">{d.doc.kind === 'draft' ? 'Écrit' : d.doc.kind === 'plan' ? 'Plan' : 'Document'}</span>
        </div>
        <p className="map-doc-missing">Document supprimé</p>
        <p className="map-doc-meta">Restaurez-le depuis la corbeille, ou supprimez cette carte.</p>
        {handles}
      </div>
    );
  return (
    <div
      className={`map-node map-doc ${selected ? 'sel' : ''}`}
      data-doc={`${d.doc.kind}:${d.doc.id}`}
      data-kind={t.label}
      data-testid="doc-node"
      style={{ '--c': TINT[t.label] } as CSSProperties}
      onDoubleClick={open}
      title="Double-clic : ouvrir"
    >
      <div className="map-doc-head">
        {ICON[t.label]}
        <span className="map-node-cat">{t.label}</span>
      </div>
      <div className="map-doc-body">
        <Body t={t} />
      </div>
      <div className="map-doc-foot">
        <button type="button" className="map-portal-open nodrag" data-act="doc-open" onClick={open} onDoubleClick={(e) => e.stopPropagation()}>
          Ouvrir <ArrowRight size={13} />
        </button>
      </div>
      {handles}
    </div>
  );
}
