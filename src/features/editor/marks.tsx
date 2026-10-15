// Marques de mise en forme de l'éditeur (¶, comme « Afficher tout » de Word) et « Révéler la mise
// en forme » : affichage seulement — rien n'est écrit dans le document, les exports ni l'impression.
//
// • Caractères invisibles : ¶ en fin de paragraphe (lignes vides comprises), · espace, ° espace
//   insécable, → tabulation, ↵ saut de ligne, « Saut de page ». Posés dans chaque ligne peinte
//   (.superdoc-line, déjà en position relative) par une couche absolue sans contenu texte
//   (glyphes en ::before) ni événements : aucune incidence sur la mise en page, le retour à la
//   ligne, la sélection ou le texte des lignes.
// • Étiquettes de paragraphe dans la marge (style · police taille · alignement), seulement là où
//   l'un de ces réglages change par rapport au paragraphe précédent ; détail complet au survol.
// • Pointillé sous les passages dont la police ou la taille diffère de celles du paragraphe.
//
// SuperDoc repeint seulement les lignes modifiées : un MutationObserver (exécuté avant l'affichage)
// complète aussitôt les lignes neuves ; chaque ligne garde une signature (contenu peint + attentes
// du modèle) pour ne rien recalculer quand rien n'a changé. Seules les pages proches de la zone
// visible sont traitées (défilement : une fois par image).
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Pilcrow, X } from 'lucide-react';
import type { Align, DocEngine, EngineState, LineSpacing, ParaFormat, RevealFormat } from './engine';
import { STYLE_LABEL } from './StyleEditor';
import './marks.css';

// ── Libellés ─────────────────────────────────────────────────
const ALIGN_WORD: Record<Align, string> = { left: 'à gauche', center: 'centré', right: 'à droite', justify: 'justifié' };
const num = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ',');
const cm = (tw: number) => `${num(tw / 567)} cm`;
const pt = (tw: number) => `${num(tw / 20, 1)} pt`;

export function styleLabel(f: Pick<ParaFormat, 'kind' | 'styleName'>): string {
  return f.kind === 'other' ? f.styleName ?? STYLE_LABEL.other : STYLE_LABEL[f.kind];
}
export function lineLabel(l: LineSpacing | null): string {
  if (!l) return 'simple';
  if ('mult' in l) return l.mult === 1 ? 'simple (1)' : num(l.mult);
  return `${l.rule === 'exact' ? 'exactement' : 'au moins'} ${num(l.pt, 1)} pt`;
}
export function indentLabel(f: Pick<ParaFormat, 'indentLeft' | 'indentRight' | 'firstLine'>): string {
  const parts: string[] = [];
  if (f.indentLeft) parts.push(`gauche ${cm(f.indentLeft)}`);
  if (f.indentRight) parts.push(`droite ${cm(f.indentRight)}`);
  if (f.firstLine > 0) parts.push(`alinéa ${cm(f.firstLine)}`);
  else if (f.firstLine < 0) parts.push(`suspendu ${cm(-f.firstLine)}`);
  return parts.length ? parts.join(' · ') : 'aucun';
}
export function spacingLabel(f: Pick<ParaFormat, 'before' | 'after'>): string {
  return `avant ${pt(f.before)} · après ${pt(f.after)}`;
}
const fontSizeLabel = (font: string | null, size: number | null) => [font, size != null ? num(size, 1) : null].filter(Boolean).join(' ');

/** Texte de l'étiquette de marge : « Corps · Literata 12 · justifié ». */
export function tagText(f: ParaFormat): string {
  return [styleLabel(f), fontSizeLabel(f.font, f.size), ALIGN_WORD[f.align]].filter(Boolean).join(' · ');
}
/** Clé de comparaison entre paragraphes consécutifs : style, police, taille, alignement. */
const tagKey = (f: ParaFormat) => `${styleLabel(f)}|${(f.font ?? '').toLowerCase()}|${f.size ?? ''}|${f.align}`;

/** Paragraphes qui reçoivent une étiquette : le premier, puis là où quelque chose change (lignes vides ignorées). */
export function taggedParagraphs(list: ParaFormat[]): Set<number> {
  const out = new Set<number>();
  let prev = '';
  for (const f of list) {
    if (f.empty) continue;
    const k = tagKey(f);
    if (k !== prev) out.add(f.pos);
    prev = k;
  }
  return out;
}

// ── Couche des marques ───────────────────────────────────────
const LAYER = 'ed-mk-layer';
/** Marge (px) autour de la zone visible où les pages sont déjà marquées. */
const AHEAD = 900;

/** Paragraphe qui contient la position `p` (liste triée, sans chevauchement). */
function paraAt(list: ParaFormat[], p: number): ParaFormat | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const f = list[mid];
    if (p < f.pos) hi = mid - 1;
    else if (p >= f.end) lo = mid + 1;
    else return f;
  }
  return null;
}

const SPACE_GLYPH: Record<string, string> = { ' ': 'sp', ' ': 'nb', ' ': 'nb', ' ': 'nb' };

interface Glyph {
  cls: string;
  x: number;
  fs: number;
  ff?: string;
  w?: number;
  top?: number;
  title?: string;
}

function makeLayer(glyphs: Glyph[]): HTMLElement {
  const layer = document.createElement('span');
  layer.className = LAYER;
  layer.setAttribute('aria-hidden', 'true');
  let html = '';
  for (const g of glyphs) {
    let st = `left:${g.x.toFixed(2)}px;font-size:${g.fs.toFixed(2)}px`;
    if (g.ff) st += `;font-family:${g.ff.replace(/"/g, "'")}`;
    if (g.w != null) st += `;width:${Math.max(0, g.w).toFixed(2)}px`;
    if (g.top != null) st += `;top:${g.top.toFixed(2)}px`;
    html += `<i class="ed-mk ed-mk-${g.cls}" style="${st}"></i>`;
  }
  layer.innerHTML = html;
  return layer;
}

type TagEl = HTMLElement & { __f?: ParaFormat; __max?: number };

/** Petites icônes d'alignement (forme compacte des étiquettes). */
const ALIGN_SVG: Record<Align, string> = (() => {
  const rows: Record<Align, [number, number][]> = {
    left: [[0, 10], [0, 5.5], [0, 8.5], [0, 4.5]],
    center: [[0, 10], [2.5, 7.5], [1, 9], [3, 7]],
    right: [[0, 10], [4.5, 10], [1.5, 10], [5.5, 10]],
    justify: [[0, 10], [0, 10], [0, 10], [0, 10]],
  };
  const out = {} as Record<Align, string>;
  for (const k of Object.keys(rows) as Align[])
    out[k] = `<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">${rows[k].map(([x1, x2], i) => `<line x1="${x1}" x2="${x2}" y1="${1 + i * 2.6}" y2="${1 + i * 2.6}" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`).join('')}</svg>`;
  return out;
})();

interface Anchor {
  f: ParaFormat;
  line: HTMLElement;
}

/**
 * Marques de mise en forme sur les pages peintes (voir l'en-tête). `tick` : état de l'éditeur
 * (transaction, zoom) — relance la mise à jour des étiquettes.
 */
export function useFormatMarks(hostRef: MutableRefObject<HTMLElement | null>, engine: () => DocEngine | null, active: boolean, tick: unknown) {
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>('.ed-scroll');
    if (!host || !scroller || !active) return;

    const tagLayer = document.createElement('div');
    tagLayer.className = 'ed-mk-tags';
    scroller.appendChild(tagLayer);
    const card = document.createElement('div');
    card.className = 'ed-mk-card';
    card.setAttribute('role', 'tooltip');
    tagLayer.appendChild(card);
    const tags = new Map<string, HTMLElement>();

    let list: ParaFormat[] = [];
    let tagged = new Set<number>();
    const sigs = new WeakMap<HTMLElement, string>();
    const layers = new WeakMap<HTMLElement, HTMLElement>();
    /** Glyphes déjà mesurés, par signature de ligne (contenu peint relatif + attentes du modèle). */
    const glyphCache = new Map<string, Glyph[]>();
    const titled = new Set<HTMLElement>();
    const range = document.createRange();

    const refreshModel = () => {
      const next = engine()?.paragraphFormats() ?? [];
      if (next !== list) {
        list = next;
        tagged = taggedParagraphs(list);
      }
    };

    /** Glyphes d'une ligne peinte du paragraphe `f` (lectures seulement : aucune écriture dans le DOM). */
    const measureLine = (line: HTMLElement, f: ParaFormat, kids: HTMLElement[], s: number, e: number): Glyph[] => {
      const lr = line.getBoundingClientRect();
      const scale = lr.width / (line.offsetWidth || 1) || 1;
      const X = (x: number) => (x - lr.left) / scale;
      const glyphs: Glyph[] = [];
      let right = -Infinity;
      let lastFs = 0;
      let lastFf = '';
      let emptyLeft: number | null = null;
      const texts = kids.filter((k) => k.classList.contains('superdoc-text-run'));
      const pmS = (k: HTMLElement) => Number(k.dataset.pmStart);
      for (const k of kids) {
        const ks = pmS(k);
        if (k.classList.contains('superdoc-empty-run')) {
          emptyLeft = X(k.getBoundingClientRect().left);
          continue;
        }
        if (f.tabs.includes(ks) && !k.classList.contains('superdoc-text-run')) {
          // tabulation : flèche au milieu de l'espace entre le texte qui précède et celui qui suit
          const before = texts.filter((t) => pmS(t) < ks);
          const after = texts.filter((t) => pmS(t) > ks);
          const a = before.length ? Math.max(...before.map((t) => X(t.getBoundingClientRect().right))) : 0;
          const b = after.length ? Math.min(...after.map((t) => X(t.getBoundingClientRect().left))) : a + 24;
          const ref = before[before.length - 1] ?? after[0];
          const fs = ref ? parseFloat(ref.style.fontSize) || 16 : ((f.size ?? 12) * 4) / 3;
          glyphs.push({ cls: 'tab', x: b - a > 14 ? (a + b) / 2 : a + 1, fs, ff: ref?.style.fontFamily });
          continue;
        }
        if (!k.classList.contains('superdoc-text-run')) continue;
        const fs = parseFloat(k.style.fontSize) || 16;
        const ff = k.style.fontFamily;
        const kr = k.getBoundingClientRect();
        const kl = X(kr.left);
        const krt = X(kr.right);
        if (krt > right) {
          right = krt;
          lastFs = fs;
          lastFf = ff;
        }
        // espaces, insécables
        const walker = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const t = node.nodeValue ?? '';
          for (let i = 0; i < t.length; i++) {
            const cls = SPACE_GLYPH[t[i]];
            if (!cls) continue;
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            glyphs.push({ cls, x: (X(r.left) + X(r.right)) / 2, fs, ff });
          }
        }
        // police ou taille différente de celle du paragraphe : pointillé dessous
        const ke = Number(k.dataset.pmEnd);
        if (f.runs.some((r) => r.from < ke && r.to > ks)) glyphs.push({ cls: 'run', x: kl, w: krt - kl, fs, top: (kr.bottom - lr.top) / scale - 1.5 });
      }
      const isLast = f.empty || e >= f.lastEnd;
      const brk = f.breaks.find((b) => b.after === e && b.after > s - 1);
      if (brk && !f.empty && right > -Infinity) {
        if (brk.page) glyphs.push({ cls: 'page', x: right + 4, w: line.offsetWidth - right - 4, fs: Math.max(9, lastFs * 0.62) });
        else glyphs.push({ cls: 'br', x: right + 1, fs: lastFs, ff: lastFf });
      } else if (isLast) {
        if (right > -Infinity) glyphs.push({ cls: 'para', x: right + 1, fs: lastFs, ff: lastFf });
        else glyphs.push({ cls: 'para', x: emptyLeft ?? 0, fs: ((f.size ?? 12) * 4) / 3 });
      }
      return glyphs;
    };

    /** Infobulle « Georgia 14 » sur les passages dont la police ou la taille diffère du paragraphe. */
    const titleRuns = (f: ParaFormat, kids: HTMLElement[]) => {
      if (!f.runs.length) return;
      const par = fontSizeLabel(f.font, f.size);
      for (const k of kids) {
        if (!k.classList.contains('superdoc-text-run')) continue;
        const ks = Number(k.dataset.pmStart);
        const ke = Number(k.dataset.pmEnd);
        const run = f.runs.find((r) => r.from < ke && r.to > ks);
        if (!run) continue;
        const title = `${fontSizeLabel(run.font, run.size)}${par ? ` (paragraphe : ${par})` : ''}`;
        if (k.title !== title) k.title = title;
        titled.add(k);
      }
    };

    const placeTags = (anchors: Anchor[]) => {
      const sr = scroller.getBoundingClientRect();
      const seen = new Set<string>();
      const placed = anchors
        .map((a) => {
          const lr = a.line.getBoundingClientRect();
          const frag = a.line.closest<HTMLElement>('[data-layout-fragment-id]') ?? a.line;
          const fr = frag.getBoundingClientRect();
          return { a, c: lr.top + lr.height / 2 - sr.top + scroller.scrollTop, x: Math.min(fr.left, lr.left) - sr.left + scroller.scrollLeft };
        })
        .sort((p, q) => p.c - q.c);
      let prevBottom = -Infinity;
      for (const p of placed) {
        const f = p.a.f;
        const text = tagText(f);
        const key = `${f.pos}|${text}`;
        seen.add(key);
        let el = tags.get(key) as TagEl | undefined;
        if (!el) {
          el = document.createElement('div') as TagEl;
          el.className = 'ed-mk-tag';
          el.dataset.pos = String(f.pos);
          el.dataset.text = text;
          // forme longue (une ligne) et forme compacte (deux lignes) : la plus lisible selon la marge
          const full = document.createElement('span');
          full.className = 'ed-mk-tag-full';
          full.textContent = text;
          const a = document.createElement('span');
          a.className = 'ed-mk-tag-a';
          // taille d'abord : un nom de police long est tronqué, la taille reste lisible
          a.textContent = [f.size != null ? num(f.size, 1) : null, f.font].filter(Boolean).join(' · ') || styleLabel(f);
          const b2 = document.createElement('span');
          b2.className = 'ed-mk-tag-b';
          b2.innerHTML = `<span></span>${ALIGN_SVG[f.align]}`;
          b2.firstElementChild!.textContent = styleLabel(f);
          b2.title = ALIGN_WORD[f.align];
          el.append(full, a, b2);
          tagLayer.appendChild(el);
          tags.set(key, el);
        }
        el.__f = f;
        const right = p.x - 8;
        const max = Math.max(40, right - 3);
        el.style.left = `${right.toFixed(1)}px`;
        if (el.__max !== max) {
          el.__max = max;
          el.style.maxWidth = `${max.toFixed(0)}px`;
          el.classList.remove('compact');
          const full = el.firstElementChild as HTMLElement;
          if (full.scrollWidth > full.clientWidth + 1) el.classList.add('compact');
        }
        const h = el.offsetHeight || 17;
        const top = Math.max(p.c - h / 2, prevBottom + 3);
        prevBottom = top + h;
        el.style.top = `${top.toFixed(1)}px`;
      }
      for (const [k, el] of tags) {
        if (seen.has(k)) continue;
        el.remove();
        tags.delete(k);
      }
    };

    const update = () => {
      refreshModel();
      const sr = scroller.getBoundingClientRect();
      const lo = sr.top - AHEAD;
      const hi = sr.bottom + AHEAD;
      const anchors: Anchor[] = [];
      const measures: { line: HTMLElement; f: ParaFormat; kids: HTMLElement[]; s: number; e: number; sig: string }[] = [];
      const writes: { line: HTMLElement; sig: string; glyphs: Glyph[] }[] = [];
      for (const page of host.querySelectorAll<HTMLElement>('.superdoc-page')) {
        const pr = page.getBoundingClientRect();
        if (pr.bottom < lo || pr.top > hi) continue;
        for (const line of page.querySelectorAll<HTMLElement>('.superdoc-line')) {
          const frag = line.closest<HTMLElement>('[data-layout-fragment-id]');
          if (!frag || line.closest('.superdoc-page-header, .superdoc-page-footer')) continue;
          const story = frag.dataset.layoutStory;
          if (story && story !== 'body') continue;
          const s = Number(line.dataset.pmStart);
          const e = Number(line.dataset.pmEnd);
          if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
          const f = paraAt(list, s);
          if (!f) continue;
          if (tagged.has(f.pos) && s <= f.firstStart && (f.empty || e >= f.firstStart)) anchors.push({ f, line });
          const kids = Array.from(line.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains(LAYER));
          // Signature relative au début de la ligne : une ligne seulement décalée par la frappe
          // plus haut (positions +1) garde la sienne, et ses glyphes déjà mesurés.
          const expect = [
            f.empty || e >= f.lastEnd ? 'P' : '',
            f.empty ? f.size : '',
            f.breaks.filter((b) => b.after === e).map((b) => (b.page ? 'pg' : 'br')).join(),
            f.tabs.filter((t) => t >= s && t <= e).map((t) => t - s).join(),
            f.runs.filter((r) => r.from < e && r.to > s).map((r) => `${r.from - s}-${r.to - s}:${r.font}${r.size}:${f.font}${f.size}`).join(),
          ].join('|');
          let sig = `${expect}|${e - s}|${line.style.cssText}`;
          for (const k of kids) sig += `#${k.className}|${Number(k.dataset.pmStart) - s}-${Number(k.dataset.pmEnd) - s}|${k.style.cssText}|${k.textContent}`;
          titleRuns(f, kids);
          const layer = line.querySelector<HTMLElement>(`:scope > .${LAYER}`);
          if (layer && sigs.get(line) === sig && layer === layers.get(line)) continue;
          const cached = glyphCache.get(sig);
          if (cached) writes.push({ line, sig, glyphs: cached });
          else measures.push({ line, f, kids, s, e, sig });
        }
      }
      // Lectures d'abord (une seule mise en page), écritures ensuite : pas d'aller-retour forcé.
      for (const m of measures) {
        const glyphs = measureLine(m.line, m.f, m.kids, m.s, m.e);
        if (glyphCache.size > 4000) glyphCache.clear();
        glyphCache.set(m.sig, glyphs);
        writes.push({ line: m.line, sig: m.sig, glyphs });
      }
      for (const w of writes) {
        w.line.querySelector(`:scope > .${LAYER}`)?.remove();
        const layer = w.glyphs.length ? makeLayer(w.glyphs) : document.createElement('span');
        if (!w.glyphs.length) {
          layer.className = LAYER;
          layer.hidden = true;
        }
        w.line.appendChild(layer);
        sigs.set(w.line, w.sig);
        layers.set(w.line, layer);
      }
      placeTags(anchors);
    };

    // Survol d'une étiquette : détail complet.
    const showCard = (el: HTMLElement) => {
      const f = (el as TagEl).__f;
      if (!f) return;
      const rows: [string, string][] = [
        ['Style', styleLabel(f)],
        ['Police', f.font ?? '—'],
        ['Taille', f.size != null ? `${num(f.size, 1)} pt` : '—'],
        ['Alignement', ALIGN_WORD[f.align]],
        ['Interligne', lineLabel(f.line)],
        ['Retraits', indentLabel(f)],
        ['Espacement', spacingLabel(f)],
      ];
      card.replaceChildren(
        ...rows.map(([k, v]) => {
          const row = document.createElement('div');
          const dt = document.createElement('span');
          dt.textContent = k;
          const dd = document.createElement('b');
          dd.textContent = v;
          row.append(dt, dd);
          return row;
        }),
      );
      card.style.top = `${parseFloat(el.style.top) + el.offsetHeight + 4}px`;
      card.style.left = `${Math.max(6, parseFloat(el.style.left) - el.offsetWidth)}px`;
      card.classList.add('on');
    };
    const onOver = (ev: PointerEvent) => {
      const t = (ev.target as HTMLElement).closest?.<HTMLElement>('.ed-mk-tag');
      if (t) showCard(t);
    };
    const onOut = (ev: PointerEvent) => {
      const to = ev.relatedTarget as HTMLElement | null;
      if (!to?.closest?.('.ed-mk-tag')) card.classList.remove('on');
    };
    tagLayer.addEventListener('pointerover', onOver);
    tagLayer.addEventListener('pointerout', onOut);

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
        mo.takeRecords();
      });
    };
    // Repeinture : complétée tout de suite (microtâche, avant l'affichage) — pas de clignotement.
    const mo = new MutationObserver((records) => {
      if (records.every((r) => (r.target as HTMLElement).closest?.(`.${LAYER}`) || [...r.addedNodes, ...r.removedNodes].every((n) => (n as HTMLElement).classList?.contains(LAYER)))) return;
      update();
      mo.takeRecords();
    });
    mo.observe(host, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    ro.observe(scroller);
    scroller.addEventListener('scroll', schedule, { passive: true });
    kick.current = schedule;
    update();
    mo.takeRecords();

    return () => {
      kick.current = () => {};
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
      scroller.removeEventListener('scroll', schedule);
      tagLayer.remove();
      for (const l of host.querySelectorAll(`.${LAYER}`)) l.remove();
      for (const k of titled) k.removeAttribute('title');
      range.detach?.();
    };
  }, [active, hostRef, engine]);

  useEffect(() => {
    if (active) kick.current();
  }, [active, tick]);
}

// ── Révéler la mise en forme ─────────────────────────────────
const MIXTE = 'mixte';
function distinct<T>(vals: T[], fmt: (v: T) => string): string {
  const s = [...new Set(vals.map(fmt))];
  return s.length === 0 ? '—' : s.length === 1 ? s[0] : MIXTE;
}

/**
 * Place de la carte : en bas de la colonne du plan quand elle est affichée (rien ne couvre alors
 * la page), sinon en bas à droite de la zone d'écriture.
 */
function useDock(ref: MutableRefObject<HTMLElement | null>, deps: unknown[]): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>();
  useLayoutEffect(() => {
    const el = ref.current;
    const body = el?.closest<HTMLElement>('.ed-body');
    const center = el?.closest<HTMLElement>('.ed-center');
    const outline = body?.querySelector<HTMLElement>('.ed-outline');
    if (!el || !body || !center || !outline) return;
    const place = () => {
      const o = outline.getBoundingClientRect();
      if (o.width < 150) {
        outline.classList.remove('ed-mk-docked');
        setStyle(undefined);
        return;
      }
      const c = center.getBoundingClientRect();
      outline.classList.add('ed-mk-docked');
      outline.style.setProperty('--ed-mk-card-h', `${el.offsetHeight + 72}px`);
      setStyle({ position: 'fixed', left: o.left + 12, width: o.width - 22, right: 'auto', bottom: window.innerHeight - c.bottom + 56 });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(outline);
    ro.observe(center);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      outline.classList.remove('ed-mk-docked');
      outline.style.removeProperty('--ed-mk-card-h');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return style;
}

/** Carte flottante : mise en forme de la sélection ou du curseur (« mixte » si elle varie). */
export function FormatReveal({ engine, fmt, open, setOpen }: { engine: () => DocEngine | null; fmt: EngineState; open: boolean; setOpen: (v: boolean) => void }) {
  const [r, setR] = useState<RevealFormat | null>(null);
  const boxRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) setR(engine()?.revealFormatting() ?? null);
  }, [engine, fmt, open]);
  const dock = useDock(boxRef, [open, !!r]);
  const rows = useMemo(() => {
    if (!r) return [];
    const effects: string[] = [];
    const eff = (b: boolean[], name: string) => {
      if (b.length > 1) effects.push(`${name} (${MIXTE})`);
      else if (b[0]) effects.push(name);
    };
    eff(r.bold, 'gras');
    eff(r.italic, 'italique');
    eff(r.underline, 'souligné');
    const color = r.colors.length > 1 ? MIXTE : r.colors[0] ? r.colors[0] : 'automatique';
    const out: { k: string; v: string; swatch?: string; group?: string }[] = [
      { group: r.empty ? 'Caractères au curseur' : 'Caractères sélectionnés', k: 'Police', v: distinct(r.fonts, (v) => v ?? '—') },
      { k: 'Taille', v: distinct(r.sizes, (v) => (v != null ? `${num(v, 1)} pt` : '—')) },
      { k: 'Effets', v: effects.length ? effects.join(', ') : 'aucun' },
      { k: 'Couleur', v: color, swatch: r.colors.length === 1 && r.colors[0] ? r.colors[0] : undefined },
      { group: r.paras.length > 1 ? `Paragraphes (${r.paras.length})` : 'Paragraphe', k: 'Style', v: distinct(r.paras, styleLabel) },
      { k: 'Alignement', v: distinct(r.paras, (p) => ALIGN_WORD[p.align]) },
      { k: 'Interligne', v: distinct(r.paras, (p) => lineLabel(p.line)) },
      { k: 'Retraits', v: distinct(r.paras, indentLabel) },
      { k: 'Espacement', v: distinct(r.paras, spacingLabel) },
    ];
    return out;
  }, [r]);
  const cls = dock ? ' docked' : '';
  if (!open)
    return (
      <button ref={(el) => void (boxRef.current = el)} className={`ed-mk-reveal-chip${cls}`} style={dock ? { ...dock, width: undefined } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} title="Afficher la mise en forme de la sélection" data-reveal-chip>
        <Pilcrow size={12} /> Mise en forme
      </button>
    );
  if (!r) return null;
  return (
    <section ref={(el) => void (boxRef.current = el)} className={`ed-mk-reveal${cls}`} style={dock} aria-label="Mise en forme de la sélection" data-reveal>
      <header>
        <span>Mise en forme</span>
        <button className="icon-btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)} aria-label="Masquer la carte « Mise en forme »" title="Masquer cette carte (les marques restent affichées)">
          <X size={12} />
        </button>
      </header>
      <dl>
        {rows.map((x) => (
          <Fragment key={x.k}>
            {x.group && <div className="ed-mk-grouphead">{x.group}</div>}
            <div className="ed-mk-row">
              <dt>{x.k}</dt>
              <dd className={x.v === MIXTE ? 'mixed' : undefined} data-k={x.k}>
                {x.swatch && <span className="ed-mk-swatch" style={{ background: x.swatch.startsWith('#') ? x.swatch : `#${x.swatch}` }} />}
                {x.v.split(' · ').map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="ed-mk-sep"> · </span>}
                    <span className="ed-mk-part">{part}</span>
                  </Fragment>
                ))}
              </dd>
            </div>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
