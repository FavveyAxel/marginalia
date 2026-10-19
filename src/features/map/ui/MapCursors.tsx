// Carte : les pointeurs des autres pendant « Travailler à plusieurs » (collab/cursors.ts).
// Positions dans le repère de la carte (pas de l'écran) : chacun voit le pointeur au bon endroit, quels
// que soient son zoom et son défilement. La carte qu'une personne déplace ou modifie est entourée de sa
// couleur, avec son prénom. Rien n'est monté hors session, ni seul dans la session.
import { useEffect, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useStore } from '../../../lib/store';
import { useCollab } from '../../collab/collabState';
import { ctxKeyOf, Publisher, useCursorGate, type Act } from '../../collab/cursors';
import { LiveCursors, type CursorSurface } from '../../collab/LiveCursors';

export function MapCursors({ mapKey, dragging, editingId }: { mapKey: string; dragging: boolean; editingId: string | null }) {
  const on = useCursorGate((s) => s.on);
  const company = useCollab((s) => s.phase === 'live' && s.members.filter((m) => m.state === 'live').length > 1);
  const inStore = useStore((s) => !!s.maps[mapKey]);
  const ctx = on && company && inStore ? ctxKeyOf('map', mapKey) : null;
  if (!ctx) return null;
  return <MapCursorsOn ctx={ctx} dragging={dragging} editingId={editingId} />;
}

function MapCursorsOn({ ctx, dragging, editingId }: { ctx: string; dragging: boolean; editingId: string | null }) {
  const rf = useReactFlow();
  const anchor = useRef<HTMLSpanElement>(null);
  const pub = useRef<Publisher | null>(null);
  const state = useRef({ dragging, editingId });
  state.current = { dragging, editingId };

  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    const p = new Publisher(ctx);
    pub.current = p;
    const actNow = (fx: number, fy: number): Act | null => {
      const st = state.current;
      if (st.dragging) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const ids: string[] = [];
        for (const n of rf.getNodes()) {
          if (!n.dragging) continue;
          ids.push(n.id);
          const inn = rf.getInternalNode(n.id);
          const pos = inn?.internals.positionAbsolute ?? n.position;
          const w = inn?.measured.width ?? n.width ?? 0;
          const h = inn?.measured.height ?? n.height ?? 0;
          x0 = Math.min(x0, pos.x);
          y0 = Math.min(y0, pos.y);
          x1 = Math.max(x1, pos.x + w);
          y1 = Math.max(y1, pos.y + h);
        }
        if (x0 < Infinity) {
          const m: [number, number, number, number] = [Math.round(x0 - fx), Math.round(y0 - fy), Math.round(x1 - x0), Math.round(y1 - y0)];
          return ids.length === 1 ? { m, n: ids[0] } : { m };
        }
      }
      return st.editingId ? { e: st.editingId } : null;
    };
    const onMove = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('.react-flow') || t.closest('.react-flow__panel, .react-flow__minimap, .react-flow__controls')) {
        p.move(null);
        return;
      }
      // Sans aimantation à la grille (15 unités par défaut) : la position exacte.
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
      p.setAct(actNow(at.x, at.y));
      p.move(at, e.timeStamp);
    };
    const onLeave = () => p.move(null);
    host.addEventListener('pointermove', onMove, true);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove, true);
      host.removeEventListener('pointerleave', onLeave);
      p.close();
      pub.current = null;
    };
  }, [ctx, rf]);

  // Fin d'un déplacement, début ou fin d'une modification : annoncé tout de suite.
  useEffect(() => {
    if (!dragging) pub.current?.setAct(editingId ? { e: editingId } : null);
  }, [dragging, editingId]);

  const surface = useMemo<CursorSurface>(
    () => ({
      resolve: (loc) => ('x' in loc ? () => rf.flowToScreenPosition(loc) : null),
      clip: () => anchor.current?.parentElement?.querySelector('.react-flow')?.getBoundingClientRect() ?? null,
      scale: () => rf.getViewport().zoom,
      ghostOf: (id) => {
        // Copie de la carte telle qu'elle est rendue ici (contenu seulement), pour la voir bouger.
        const host = anchor.current?.parentElement;
        const node = host?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
        const inner = node?.firstElementChild as HTMLElement | null;
        const n = rf.getInternalNode(id);
        if (!inner || !n) return null;
        const el = inner.cloneNode(true) as HTMLElement;
        el.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        el.querySelectorAll('.react-flow__handle').forEach((x) => x.remove());
        return { el, w: n.measured.width ?? inner.offsetWidth, h: n.measured.height ?? inner.offsetHeight };
      },
      frameOf: (id) => {
        const n = rf.getInternalNode(id);
        if (!n || n.hidden) return null;
        const z = rf.getViewport().zoom;
        const tl = rf.flowToScreenPosition(n.internals.positionAbsolute);
        return new DOMRect(tl.x, tl.y, (n.measured.width ?? 0) * z, (n.measured.height ?? 0) * z);
      },
    }),
    [rf],
  );

  return (
    <>
      <span ref={anchor} hidden />
      <LiveCursors ctx={ctx} surface={surface} />
    </>
  );
}
