// Livres et documents : la sélection de texte des autres pendant « Travailler à plusieurs » (comme dans
// un traitement de texte partagé : le passage choisi teinté de la couleur de la personne, son prénom au bout).
//
// Repères (jamais le texte sélectionné, seulement où il est) — même canal chiffré et même cadence que les
// pointeurs (collab/cursors.ts, champ « s ») :
//  - EPUB / DOCX / Markdown / texte / HTML : chapitre + offsets [début, fin) dans le textContent du chapitre
//    (.html-chapter-text), la règle d'ancrage des surlignages. Le texte se recompose chez chacun (largeur,
//    taille de texte, page par page) : seuls des offsets dans le texte retombent sur les mêmes mots.
//  - PDF : page + offsets dans le textContent du calque de texte de la page (.textLayer). Ce calque est
//    construit par pdf.js à partir du fichier, identique chez tous quel que soit le zoom ; des offsets y
//    désignent donc les mêmes glyphes, et les rectangles sont recalculés ici, à la taille d'ici, exactement
//    comme la sélection locale (mêmes boîtes, mêmes lignes). Des rectangles en fractions de page auraient
//    figé le dessin de l'expéditeur (déformations de la couche texte comprises) sans rien gagner.
//  - Photos : rectangles en fractions de l'image. Le texte reconnu (OCR) est propre à chaque poste (fait ou
//    non, corrigé ou non) : des offsets n'y voudraient rien dire chez l'autre, alors que l'image est fixe.
//    Sans texte reconnu chez l'expéditeur, rien n'est sélectionnable, donc rien n'est envoyé.
// Rendu : rectangles calculés ici (Range.getClientRects nœud texte par nœud texte, fusionnés par ligne)
// dans une couche superposée sans interaction (pointer-events: none), recalculés au défilement, au
// redimensionnement et quand la mise en page change (taille de texte, page rendue).
import { memo, useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { useCollab } from '../collab/collabState';
import { MAX_SEL_RECTS, cursorShown, peersIn, selShown, subscribe, type Publisher, type Sel } from '../collab/cursors';
import { mergeLineRects, type Px } from './pdf/textindex';
import { offsetOf, rangeFor } from './html/anchoring';
import '../collab/cursors.css';

export type SelKind = 'pdf' | 'image' | 'html';
const SCROLL = '.pdf-scroll, .img-scroll, .html-scroll';
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

const elOf = (n: Node): Element | null => (n.nodeType === 1 ? (n as Element) : n.parentElement);

/** Rectangles (écran) du texte couvert par `range`, nœud texte par nœud texte (sans les boîtes des éléments
 *  entièrement couverts, qui feraient des blocs pleins), fusionnés par ligne. `within` : limite de parcours. */
export function textRects(range: Range, within: Node): Px[] {
  const out: Px[] = [];
  const push = (t: Text, s: number, e: number) => {
    if (e <= s) return;
    const sub = document.createRange();
    sub.setStart(t, s);
    sub.setEnd(t, e);
    for (const q of Array.from(sub.getClientRects())) if (q.width > 0.5 && q.height > 0.5) out.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
  };
  const sc = range.startContainer;
  const ec = range.endContainer;
  if (sc === ec && sc.nodeType === 3) push(sc as Text, range.startOffset, range.endOffset);
  else {
    const w = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    // Départ direct au premier nœud texte quand la sélection commence dans un texte (cas courant).
    if (sc.nodeType === 3 && within.contains(sc)) {
      w.currentNode = sc;
      n = sc;
    } else n = w.nextNode();
    let guard = 0;
    while (n && guard++ < 200000) {
      const t = n as Text;
      if (range.comparePoint(t, 0) > 0) break; // après la fin
      if (range.intersectsNode(t)) push(t, t === sc ? range.startOffset : 0, t === ec ? range.endOffset : t.data.length);
      if (t === ec) break;
      n = w.nextNode();
    }
  }
  return mergeLineRects(out);
}

/** Ma sélection courante, rattachée au contenu de ce livre (null : aucune, ou hors de ce livre, ou hors de la vue). */
export function encodeSel(host: HTMLElement, kind: SelKind): Sel | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  const sc = host.querySelector<HTMLElement>(SCROLL);
  if (!sc || !(sc.contains(r.startContainer) || sc.contains(r.commonAncestorContainer))) return null;
  // Passage sorti de la vue (page tournée, défilement) : la sélection n'est plus montrée aux autres.
  const vr = sc.getBoundingClientRect();
  const br = r.getBoundingClientRect();
  if (br.bottom < vr.top || br.top > vr.bottom || br.right < vr.left || br.left > vr.right) return null;
  const startEl = elOf(r.startContainer);
  if (kind === 'image') {
    const page = startEl?.closest<HTMLElement>('.img-page');
    const layer = page?.querySelector('.img-text');
    const n = Number(page?.dataset.page);
    if (!page || !layer || !Number.isFinite(n) || !layer.contains(r.startContainer)) return null;
    const pr = page.getBoundingClientRect();
    if (!pr.width || !pr.height) return null;
    const rects = textRects(r, layer).slice(0, MAX_SEL_RECTS);
    if (!rects.length) return null;
    const c = (v: number) => Math.min(1, Math.max(0, v));
    const flat: number[] = [];
    for (const q of rects) {
      const x = c((q.left - pr.left) / pr.width);
      const y = c((q.top - pr.top) / pr.height);
      flat.push(r4(x), r4(y), r4(c((q.right - pr.left) / pr.width) - x), r4(c((q.bottom - pr.top) / pr.height) - y));
    }
    return { u: `p${n}`, r: flat };
  }
  let root: HTMLElement | null;
  let u: string;
  if (kind === 'pdf') {
    let page = startEl?.closest<HTMLElement>('.pdf-page') ?? null;
    let layer = page?.querySelector<HTMLElement>('.textLayer') ?? null;
    if (!layer || !layer.contains(r.startContainer)) {
      layer = Array.from(sc.querySelectorAll<HTMLElement>('.textLayer')).find((x) => r.intersectsNode(x)) ?? null;
      page = layer?.closest<HTMLElement>('.pdf-page') ?? null;
    }
    const n = Number(page?.dataset.page);
    if (!layer || !Number.isFinite(n)) return null;
    root = layer;
    u = `p${n}`;
  } else {
    root = startEl?.closest<HTMLElement>('.html-chapter-text') ?? null;
    if (!root || !root.contains(r.startContainer)) root = Array.from(sc.querySelectorAll<HTMLElement>('.html-chapter-text')).find((x) => r.intersectsNode(x)) ?? null;
    const n = Number(root?.dataset.chapter);
    if (!root || !Number.isFinite(n)) return null;
    u = `c${n}`;
  }
  // Limitée à la première page / au premier chapitre touché (comme un extrait).
  const a = root.contains(r.startContainer) ? offsetOf(root, r.startContainer, r.startOffset) : 0;
  const b = root.contains(r.endContainer) ? offsetOf(root, r.endContainer, r.endOffset) : (root.textContent ?? '').length;
  if (a < 0 || b <= a) return null;
  return { u, a, b };
}

/** Lecture d'une sélection reçue : fonction rappelée à chaque recalcul (rectangles à l'écran), ou null. */
function decodeSel(host: HTMLElement, kind: SelKind, s: Sel): (() => Px[]) | null {
  const n = Number(s.u.slice(1));
  if ('r' in s) {
    if (kind !== 'image' || s.u[0] !== 'p') return null;
    return () => {
      const pg = host.querySelector<HTMLElement>(`.img-page[data-page="${n}"]`);
      const pr = pg?.getBoundingClientRect();
      if (!pr || !pr.width) return [];
      const out: Px[] = [];
      for (let i = 0; i + 3 < s.r.length; i += 4) {
        const left = pr.left + s.r[i] * pr.width;
        const top = pr.top + s.r[i + 1] * pr.height;
        out.push({ left, top, right: left + s.r[i + 2] * pr.width, bottom: top + s.r[i + 3] * pr.height });
      }
      return out;
    };
  }
  if (kind === 'image') return null;
  if ((kind === 'pdf') !== (s.u[0] === 'p')) return null;
  const sel = kind === 'pdf' ? `.pdf-page[data-page="${n}"] .textLayer` : `.html-chapter-text[data-chapter="${n}"]`;
  let root: HTMLElement | null = null;
  let range: Range | null = null;
  return () => {
    // Le calque de texte d'une page PDF naît et meurt avec le rendu de la page ; le chapitre peut être remplacé.
    if (!root || !root.isConnected) {
      root = host.querySelector<HTMLElement>(sel);
      range = null;
    }
    if (!root) return [];
    if (!range || !range.startContainer.isConnected || !range.endContainer.isConnected || !root.contains(range.startContainer)) range = rangeFor(root, s.a, s.b);
    return range ? textRects(range, root) : [];
  };
}

/** Côté expéditeur : suit ma sélection dans ce livre et la confie au Publisher (cadence limitée, envoi si changement). */
export function trackMySelection(host: HTMLElement, kind: SelKind, p: Publisher): { refresh(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const read = () => {
    timer = null;
    last = performance.now();
    p.setSel(encodeSel(host, kind));
  };
  // Au plus un calcul toutes les 40 ms (comme l'envoi), le dernier état toujours lu.
  const refresh = () => {
    if (timer) return;
    const wait = Math.max(0, last + 40 - performance.now());
    timer = setTimeout(read, wait);
  };
  document.addEventListener('selectionchange', refresh);
  return {
    refresh,
    stop() {
      document.removeEventListener('selectionchange', refresh);
      if (timer) clearTimeout(timer);
    },
  };
}

/** Côté destinataire : la couche des sélections des autres. */
export const RemoteSelections = memo(function RemoteSelections({ ctx, kind, hostRef }: { ctx: string; kind: SelKind; hostRef: { current: HTMLElement | null } }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const members = useCollab((s) => s.members);
  const layer = useRef<HTMLDivElement>(null);
  const groups = useRef(new Map<string, HTMLDivElement>());
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let raf = 0;
    const cache = new Map<string, { json: string; f: (() => Px[]) | null }>();
    const draw = () => {
      raf = 0;
      const root = layer.current;
      const host = hostRef.current;
      if (!root || !host) return;
      const lr = root.getBoundingClientRect();
      const clip = host.querySelector(SCROLL)?.getBoundingClientRect();
      const now = performance.now();
      const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let again = false;
      for (const p of peersIn(ctx)) {
        const g = groups.current.get(p.id);
        if (!g) continue;
        // Rejouée au rythme du pointeur (même retard) : la teinte ne court pas devant lui.
        const { sel, later } = selShown(p, now, still);
        if (later) again = true;
        let rects: Px[] = [];
        if (sel && clip) {
          const json = JSON.stringify(sel);
          let c = cache.get(p.id);
          if (!c || c.json !== json) cache.set(p.id, (c = { json, f: decodeSel(host, kind, sel) }));
          rects = (c.f?.() ?? [])
            .map((q) => ({ left: Math.max(q.left, clip.left), right: Math.min(q.right, clip.right), top: Math.max(q.top, clip.top), bottom: Math.min(q.bottom, clip.bottom) }))
            .filter((q) => q.right - q.left > 0.5 && q.bottom - q.top > 0.5);
        } else cache.delete(p.id);
        const boxes = g.querySelector<HTMLElement>('.rs-rects')!;
        while (boxes.childElementCount > rects.length) boxes.lastElementChild!.remove();
        while (boxes.childElementCount < rects.length) {
          const d = document.createElement('div');
          d.className = 'rs-rect';
          boxes.appendChild(d);
        }
        rects.forEach((q, i) => {
          const d = boxes.children[i] as HTMLElement;
          d.style.transform = `translate3d(${(q.left - lr.left).toFixed(1)}px, ${(q.top - lr.top).toFixed(1)}px, 0)`;
          d.style.width = `${(q.right - q.left).toFixed(1)}px`;
          d.style.height = `${(q.bottom - q.top).toFixed(1)}px`;
        });
        // Étiquette au bout de la sélection (fin de la dernière ligne).
        const end = rects.length ? rects.reduce((a, b) => (b.top > a.top + 1 || (Math.abs(b.top - a.top) <= 1 && b.right > a.right) ? b : a)) : null;
        const tag = g.querySelector<HTMLElement>('.rs-end')!;
        if (end) {
          tag.style.transform = `translate3d(${(end.right - lr.left).toFixed(1)}px, ${(end.top - lr.top).toFixed(1)}px, 0)`;
          tag.style.height = `${(end.bottom - end.top).toFixed(1)}px`;
        }
        const state = end ? 'on' : 'off';
        if (g.dataset.state !== state) g.dataset.state = state;
        // Prénom au bout de la sélection seulement quand son pointeur n'est pas à l'écran (il porte déjà le sien).
        const tagOn = cursorShown(ctx, p.id) ? '0' : '1';
        if (g.dataset.tag !== tagOn) g.dataset.tag = tagOn;
      }
      if (again) kick.current();
    };
    kick.current = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const off = subscribe(ctx, () => {
      bump();
      kick.current();
    });
    const onView = () => kick.current();
    window.addEventListener('resize', onView);
    document.addEventListener('scroll', onView, true);
    // Mise en page qui change sans défilement : taille de texte, page PDF rendue, chapitre remplacé.
    const host = hostRef.current;
    // (Les couches des pointeurs et des sélections bougent à chaque image : ignorées.)
    const mo = new MutationObserver((recs) => {
      if (!peersIn(ctx).some((p) => p.sel)) return;
      if (recs.some((r) => !elOf(r.target)?.closest('.rc-layer, .rs-layer'))) kick.current();
    });
    if (host) mo.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'data-page'] });
    const ro = new ResizeObserver(onView);
    const sc = host?.querySelector(SCROLL);
    if (sc) {
      ro.observe(sc);
      if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    }
    kick.current();
    return () => {
      off();
      mo.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onView);
      document.removeEventListener('scroll', onView, true);
      kick.current = () => undefined;
    };
  }, [ctx, kind, hostRef]);

  useEffect(() => kick.current());

  const list = peersIn(ctx).filter((p) => p.sel);
  const who = (id: string) => members.find((m) => m.id === id && m.state === 'live');
  if (!list.length) {
    return <div className="rs-layer" ref={layer} data-testid="remote-selections" />;
  }
  return (
    <div className="rs-layer" ref={layer} data-testid="remote-selections">
      {list.map((p) => {
        const m = who(p.id);
        if (!m) return null;
        return (
          <div
            key={p.id}
            className="rs-peer"
            data-testid="remote-selection"
            data-peer={p.id}
            data-name={m.name}
            data-state="off"
            aria-hidden="true"
            style={{ '--rc': m.color } as CSSProperties}
            ref={(el) => {
              if (el) groups.current.set(p.id, el);
              else groups.current.delete(p.id);
            }}
          >
            <div className="rs-rects" />
            <div className="rs-end">
              <span className="rs-name">{m.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});
