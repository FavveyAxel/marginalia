// ─────────────────────────────────────────────────────────────
// Pointeurs des autres (affichage) : une couche au-dessus d'une carte ou d'un livre ouvert.
//
// Fluidité : les positions reçues (≈ 25 par seconde, à intervalles irréguliers) sont rejouées avec un
// léger retard (DELAY) selon l'horloge de l'expéditeur, et reliées par une courbe de Catmull-Rom :
// le mouvement reste continu même si des paquets arrivent en grappes. Chaque position est rattachée
// au contenu et relue à chaque image (zoom, défilement, mise en page d'ici). Le pointeur s'efface en
// fondu après IDLE_MS sans mouvement, ou dès que la personne quitte la vue.
// prefers-reduced-motion : aucune interpolation (dernière position, saut direct), aucun fondu.
// Sobriété : la boucle requestAnimationFrame ne tourne que tant qu'un pointeur est actif ; personne
// d'autre ici → rien n'est rendu.
// ─────────────────────────────────────────────────────────────
import { memo, useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { useCollab } from './collabState';
import { IDLE_MS, peersIn, subscribe, type Loc, type Peer, type Sample } from './cursors';
import './cursors.css';

export interface Pt {
  x: number;
  y: number;
}
export interface CursorSurface {
  /** Prépare la lecture d'une position reçue : fonction rappelée à chaque image (point à l'écran), ou null si
   *  cette position n'existe pas ici (autre page non affichée, chapitre absent…). */
  resolve(loc: Loc): (() => Pt | null) | null;
  /** Zone visible à l'écran : un pointeur hors de cette zone n'est pas affiché. */
  clip(): DOMRect | null;
  /** Échelle (zoom de la carte ; 1 ailleurs). */
  scale?(): number;
  /** Rectangle à l'écran d'une carte en cours de modification. */
  frameOf?(nodeId: string): DOMRect | null;
}

/** Retard de rejeu (ms) : couvre l'irrégularité d'arrivée de deux à trois paquets. */
const DELAY = 110;

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const u2 = u * u;
  const u3 = u2 * u;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** Position à l'écran d'une personne à l'instant `now` (null : pas de pointeur ici). */
function positionOf(p: Peer, now: number, res: (s: Sample | undefined) => Pt | null, still: boolean): Pt | null {
  const s = p.samples;
  const last = s[s.length - 1];
  if (!last || !last.loc) return null;
  if (still) return res(last);
  const rt = now - p.offset - DELAY;
  if (rt >= last.t) return res(last);
  let i = s.length - 2;
  while (i > 0 && s[i].t > rt) i--;
  const a = s[i];
  const b = s[i + 1];
  if (!a || rt <= a.t) return res(a) ?? res(b);
  const pa = res(a);
  const pb = res(b);
  if (!pa || !pb) return pb ?? null; // changement de page, ou retour dans la vue : saut
  const u = Math.min(1, Math.max(0, (rt - a.t) / Math.max(1, b.t - a.t)));
  return catmull(res(s[i - 1]) ?? pa, pa, pb, res(s[i + 2]) ?? pb, u);
}

export const LiveCursors = memo(function LiveCursors({ ctx, surface, unit }: { ctx: string; surface: CursorSurface; unit?: string | null }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const members = useCollab((s) => s.members);
  const layer = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const frames = useRef(new Map<string, HTMLDivElement>());
  const chips = useRef(new Map<string, HTMLSpanElement>());
  const surf = useRef(surface);
  surf.current = surface;
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let raf = 0;
    const cache = new WeakMap<Sample, (() => Pt | null) | null>();
    const res = (s: Sample | undefined): Pt | null => {
      if (!s || !s.loc) return null;
      let f = cache.get(s);
      if (f === undefined) {
        f = surf.current.resolve(s.loc);
        cache.set(s, f);
      }
      return f ? f() : null;
    };
    const place = (el: HTMLElement, x: number, y: number) => {
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };
    const show = (el: HTMLElement, state: 'on' | 'off' | 'idle') => {
      if (el.dataset.state !== state) el.dataset.state = state;
    };
    const tick = () => {
      raf = 0;
      const root = layer.current;
      if (!root) return;
      const now = performance.now();
      const lr = root.getBoundingClientRect();
      const clip = surf.current.clip();
      const sc = surf.current.scale?.() ?? 1;
      const still = reduced();
      let again = false;
      for (const p of peersIn(ctx)) {
        const el = els.current.get(p.id);
        const idle = now - p.lastAt > IDLE_MS;
        const pt = idle ? null : positionOf(p, now, res, still);
        const inside = !!pt && !!clip && pt.x >= clip.left - 2 && pt.x <= clip.right + 2 && pt.y >= clip.top - 2 && pt.y <= clip.bottom + 2;
        if (el) {
          if (inside) place(el, pt!.x - lr.left, pt!.y - lr.top);
          show(el, inside ? 'on' : idle ? 'idle' : 'off');
        }
        const chip = chips.current.get(p.id);
        if (chip) chip.hidden = inside;
        if (!idle) again = true;
        // Cadre de la carte déplacée ou modifiée.
        const fr = frames.current.get(p.id);
        if (fr) {
          let r: { x: number; y: number; w: number; h: number } | null = null;
          if (p.act && 'm' in p.act && inside && pt) r = { x: pt.x + p.act.m[0] * sc, y: pt.y + p.act.m[1] * sc, w: p.act.m[2] * sc, h: p.act.m[3] * sc };
          else if (p.act && 'e' in p.act) {
            const b = surf.current.frameOf?.(p.act.e);
            if (b) r = { x: b.left, y: b.top, w: b.width, h: b.height };
            again = true;
          }
          if (r) {
            const pad = 6;
            place(fr, r.x - lr.left - pad, r.y - lr.top - pad);
            fr.style.width = `${(r.w + pad * 2).toFixed(1)}px`;
            fr.style.height = `${(r.h + pad * 2).toFixed(1)}px`;
          }
          show(fr, r ? 'on' : 'off');
          fr.dataset.kind = p.act && 'm' in p.act ? 'move' : 'edit';
        }
      }
      if (again) raf = requestAnimationFrame(tick);
      else {
        // Dernier passage après le fondu : rien ne tourne plus.
        for (const el of els.current.values()) show(el, 'idle');
      }
    };
    kick.current = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const off = subscribe(ctx, () => {
      bump();
      kick.current();
    });
    // Relecture quand la vue d'ici bouge (défilement, zoom) même si personne ne bouge.
    const onView = () => kick.current();
    window.addEventListener('resize', onView);
    document.addEventListener('scroll', onView, true);
    document.addEventListener('wheel', onView, { capture: true, passive: true });
    kick.current();
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onView);
      document.removeEventListener('scroll', onView, true);
      document.removeEventListener('wheel', onView, true);
      kick.current = () => undefined;
    };
  }, [ctx]);

  // Après chaque rendu (nouvelle personne, nouvelle couleur) : une image de plus.
  useEffect(() => kick.current());

  const list = peersIn(ctx);
  if (!list.length) return null;
  const who = (id: string) => members.find((m) => m.id === id && m.state === 'live');
  const away = list.filter((p) => p.where && unit && p.where.u !== unit && who(p.id));
  return (
    <div className="rc-layer" ref={layer} data-testid="remote-cursors">
      {list.map((p) => {
        const m = who(p.id);
        if (!m) return null;
        const style = { '--rc': m.color } as CSSProperties;
        return (
          <div key={p.id} className="rc-peer" aria-hidden="true">
            <div
              className="rc-frame"
              data-testid="remote-frame"
              data-peer={p.id}
              data-state="off"
              style={style}
              ref={(el) => {
                if (el) frames.current.set(p.id, el);
                else frames.current.delete(p.id);
              }}
            >
              <span className="rc-frame-name">{p.act && 'e' in p.act ? `${m.name} modifie` : m.name}</span>
            </div>
            <div
              className="rc-cursor"
              data-testid="remote-cursor"
              data-peer={p.id}
              data-name={m.name}
              data-state="off"
              style={{ ...style, transform: 'translate3d(-100px,-100px,0)' }}
              ref={(el) => {
                if (el) els.current.set(p.id, el);
                else els.current.delete(p.id);
              }}
            >
              <svg className="rc-arrow" width="18" height="21" viewBox="0 0 18 21" aria-hidden="true">
                <path d="M1.6 1.4v15.4l4.1-3.9 2.9 6.3 2.9-1.3-2.8-6.2h5.7z" fill={m.color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="rc-name">{m.name}</span>
            </div>
          </div>
        );
      })}
      {away.length > 0 && (
        <div className="rc-where" role="status">
          {away.map((p) => {
            const m = who(p.id)!;
            return (
              <span
                key={p.id}
                className="rc-chip"
                data-testid="remote-where"
                ref={(el) => {
                  if (el) chips.current.set(p.id, el);
                  else chips.current.delete(p.id);
                }}
              >
                <span className="rc-dot" style={{ background: m.color }} />
                {m.name} lit {p.where!.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
});

