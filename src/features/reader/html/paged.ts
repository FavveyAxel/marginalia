// Lecture « page par page » (réglage readerLayout === 'paged') — comme un livre ou une liseuse.
//
// Principe : le DOM du texte ne change pas (mêmes chapitres, mêmes .html-chapter-text, mêmes
// repères de page, surlignages, résultats de recherche) ; seule la mise en forme change.
// - Chaque chapitre (.html-col) devient un conteneur multicolonne de hauteur fixe : une colonne
//   par page d'écran (largeur = largeur du texte de la page, intervalle = deux marges latérales,
//   si bien que le pas d'une colonne à l'autre est exactement la largeur d'une page). Tourner la
//   page = translater la colonne (transform : composition seule, aucune remise en page).
// - Les feuilles (.paged-page : papier, ombre, pli central, titre courant, folio) sont un calque
//   SOUS le texte, hors du conteneur de texte : rien n'entre dans le textContent, donc les
//   offsets des surlignages ne bougent pas, et la sélection traverse librement les deux pages
//   d'une double page (elles appartiennent au même flux multicolonne).
// - Paresseux par chapitre : seul le chapitre lu est affiché ; ses voisins sont mis en page mais
//   invisibles (le passage d'un chapitre à l'autre est immédiat) ; les autres ne sont pas rendus.
// - Une page = deux pages côte à côte (« Deux pages »), une seule (« Une page »), ou selon la
//   largeur du volet (« Automatique »). Chaque chapitre commence sur une nouvelle page (à gauche).
import { romanToInt } from '../pages';
import './paged.css';

export type PagedSpread = 'single' | 'double' | 'auto';

export interface PagedHost {
  scroll: HTMLElement;
  doc: HTMLElement;
  sections(): HTMLElement[];
  roots(): HTMLElement[];
  texts(): string[];
  /** Repères de page (un par page du livre, dans l'ordre), 1er repère de chaque chapitre, libellés. */
  marks(): HTMLElement[];
  firstMark(): number[];
  labels(): string[];
  bookTitle(): string;
  chapterTitle(i: number): string;
  spread(): PagedSpread;
  /** Largeur du texte (réglage, en ch). */
  measure(): number;
  /** Appelé après chaque page montrée (position, indicateur, repères de marge). */
  onShown(info: { chapterChanged: boolean; user: boolean }): void;
}

interface Geo {
  W: number;
  H: number;
  n: 1 | 2;
  /** Page : largeur, hauteur ; marges latérale, haute, basse ; zone de texte. */
  w: number;
  h: number;
  mx: number;
  mt: number;
  mb: number;
  cw: number;
  ch: number;
  left: number;
  top: number;
  lineH: number;
}

/** Repère de page d'un chapitre, tel que mis en page. */
interface MarkPos {
  /** Indice de la page du livre. */
  index: number;
  /** Offset (dans le chapitre) du premier caractère de la page. */
  off: number;
  /** Page d'écran (colonne) où commence la page du livre. */
  col: number;
  /** Centre de la ligne où elle commence, depuis le haut de la colonne. */
  y: number;
  /** La page du livre commence exactement en haut de cette page d'écran (ou ouvre le chapitre). */
  atTop: boolean;
  /** Au milieu d'un paragraphe : encoche au mot exact (x, haut, hauteur, depuis le coin de la colonne). */
  tick: { x: number; top: number; h: number } | null;
}

const TURN_MS = 260;
const RATIO = 0.7; // largeur / hauteur maximale d'une page (livre)
const MIN_RATIO = 0.6; // une page n'est jamais plus haute que cette proportion
const WHEEL_IDLE = 220;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const isEditing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, button, [contenteditable=""], [contenteditable="true"], [role="dialog"], .floating');
};

export class PagedLayout {
  chapter = 0;
  /** Première colonne (page d'écran) montrée dans le chapitre ; multiple de n. */
  page = 0;
  geo: Geo | null = null;
  private counts = new Map<number, number>();
  private markCache = new Map<number, MarkPos[]>();
  /** Offset du premier caractère (non blanc) de chaque page d'écran : `${chapitre}:${colonne}`. */
  private colStarts = new Map<string, number>();
  /** Chapitre dont les pastilles de marge sont posées (null : à refaire). */
  private pillsOf: number | null = null;
  private firstOff: number | null = null;
  private desk: HTMLElement;
  private spreadEl: HTMLElement;
  private sheets: HTMLElement[] = [];
  private arrows: HTMLElement[];
  private cleanup: (() => void)[] = [];
  /** Page demandée par « Aller à la page » : l'indicateur la montre tant qu'elle reste visible. */
  pinnedLabel: number | null = null;
  /**
   * Passage visé par la dernière navigation (position restaurée, extrait, recherche…) : tant que
   * le lecteur ne tourne pas la page, une remise en page (taille du texte, fenêtre, une ou deux
   * pages) le garde à l'écran, au lieu de dériver vers le début de la page qui le contenait.
   */
  keep: { chapter: number; offset: number } | null = null;

  constructor(private host: PagedHost) {
    this.desk = document.createElement('div');
    this.desk.className = 'paged-desk';
    this.desk.setAttribute('aria-hidden', 'true');
    this.spreadEl = document.createElement('div');
    this.spreadEl.className = 'paged-spread';
    const prev = document.createElement('div');
    prev.className = 'paged-arrow paged-arrow-prev';
    const next = document.createElement('div');
    next.className = 'paged-arrow paged-arrow-next';
    this.arrows = [prev, next];
    this.desk.append(this.spreadEl, prev, next);
  }

  // ── Mise en place ─────────────────────────────────────────

  attach() {
    const { scroll } = this.host;
    scroll.scrollTop = 0;
    scroll.classList.add('paged-scroll');
    scroll.insertBefore(this.desk, scroll.firstChild);
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onWheel = (e: WheelEvent) => this.onWheel(e);
    const onMove = (e: MouseEvent) => this.onMove(e);
    const onLeave = () => this.setZone('');
    window.addEventListener('keydown', onKey);
    scroll.addEventListener('wheel', onWheel, { passive: true });
    scroll.addEventListener('mousemove', onMove, { passive: true });
    scroll.addEventListener('mouseleave', onLeave);
    this.cleanup.push(
      () => window.removeEventListener('keydown', onKey),
      () => scroll.removeEventListener('wheel', onWheel),
      () => scroll.removeEventListener('mousemove', onMove),
      () => scroll.removeEventListener('mouseleave', onLeave),
    );
  }

  detach() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.desk.remove();
    this.clearPills();
    const { scroll, doc } = this.host;
    scroll.classList.remove('paged-scroll');
    delete scroll.dataset.zone;
    for (const sec of this.host.sections()) {
      sec.classList.remove('paged-cur', 'paged-near');
      const col = sec.firstElementChild as HTMLElement | null;
      if (col) {
        col.getAnimations?.().forEach((a) => a.cancel());
        col.style.transform = '';
      }
    }
    for (const p of ['--pg-w', '--pg-h', '--pg-mx', '--pg-mt', '--pg-mb', '--pg-cw', '--pg-ch', '--pg-n', '--pg-left', '--pg-top']) doc.style.removeProperty(p);
    this.geo = null;
  }

  /** Géométrie des pages d'après la taille du volet et les réglages ; remet la mise en page à zéro. */
  layout() {
    const { scroll, doc } = this.host;
    const W = scroll.clientWidth;
    const H = scroll.clientHeight;
    if (!W || !H) return;
    const cs = getComputedStyle(doc);
    const fs = parseFloat(cs.fontSize) || 19;
    const lineH = parseFloat(cs.lineHeight) || fs * 1.6;
    const narrow = W < 640;
    const padY = narrow ? 16 : clamp(H * 0.04, 18, 40);
    const side = narrow ? 12 : clamp(W * 0.04, 24, 64);
    const availH = H - 2 * padY;
    const availW = W - 2 * side;
    const w1 = Math.min(availH * RATIO, availW);
    const w2 = Math.min(availH * RATIO, availW / 2);
    // Deux pages seulement si chacune garde une ligne confortable (≈ 40 signes au moins).
    const minW = Math.max(360, fs * 22);
    const sp = this.host.spread();
    const n: 1 | 2 = sp === 'double' ? 2 : sp === 'single' ? 1 : w2 >= minW ? 2 : 1;
    const w = Math.floor(n === 2 ? w2 : w1);
    const h = Math.floor(Math.min(availH, w / MIN_RATIO));
    // Largeur du texte : le réglage (en ch de la police de lecture), sans réduire les marges
    // sous un minimum ; les marges absorbent le reste (la page garde sa taille).
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;width:${this.host.measure()}ch`;
    doc.appendChild(probe);
    const measurePx = probe.getBoundingClientRect().width || this.host.measure() * fs * 0.5;
    probe.remove();
    const mxMin = Math.max(narrow ? 20 : 30, w * (narrow ? 0.07 : 0.085));
    const cw0 = Math.floor(Math.min(w - 2 * mxMin, measurePx));
    const mx = Math.floor((w - cw0) / 2);
    const cw = w - 2 * mx;
    const mt = Math.round(fs * (narrow ? 2.4 : 2.9));
    const mb = Math.round(fs * (narrow ? 2.5 : 3.0));
    const lines = Math.max(4, Math.floor((h - mt - mb) / lineH));
    const ch = Math.round(lines * lineH);
    const left = Math.round((W - n * w) / 2);
    // Un peu plus de table sous la page que dessus : son ombre portée n'est pas coupée.
    const top = Math.max(0, Math.round((H - h) / 2 - Math.min(8, padY / 3)));
    this.geo = { W, H, n, w, h, mx, mt, mb, cw, ch, left, top, lineH };
    const st = doc.style;
    st.setProperty('--pg-w', `${w}px`);
    st.setProperty('--pg-h', `${h}px`);
    st.setProperty('--pg-mx', `${mx}px`);
    st.setProperty('--pg-mt', `${mt}px`);
    st.setProperty('--pg-mb', `${mb}px`);
    st.setProperty('--pg-cw', `${cw}px`);
    st.setProperty('--pg-ch', `${ch}px`);
    st.setProperty('--pg-n', String(n));
    st.setProperty('--pg-left', `${left}px`);
    st.setProperty('--pg-top', `${top}px`);
    // Calque des feuilles.
    const ds = this.desk.style;
    for (const [k, v] of Object.entries({ '--pg-w': w, '--pg-h': h, '--pg-mx': mx, '--pg-mt': mt, '--pg-mb': mb, '--pg-left': left, '--pg-top': top })) ds.setProperty(k, `${v}px`);
    this.desk.classList.toggle('is-double', n === 2);
    this.desk.classList.toggle('is-narrow', narrow);
    if (this.sheets.length !== n) {
      this.spreadEl.textContent = '';
      this.sheets = [];
      for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        p.className = `paged-page ${n === 2 ? (i === 0 ? 'paged-verso' : 'paged-recto') : 'paged-single'}`;
        const head = document.createElement('div');
        head.className = 'paged-head';
        const folio = document.createElement('div');
        folio.className = 'paged-folio';
        p.append(head, folio);
        this.spreadEl.appendChild(p);
        this.sheets.push(p);
      }
      if (n === 2) {
        const g = document.createElement('div');
        g.className = 'paged-gutter';
        this.spreadEl.appendChild(g);
      }
    }
    this.invalidate();
  }

  /** Mise en page du texte changée (police, surlignages qui coupent des nœuds…) : caches à refaire. */
  invalidate() {
    this.counts.clear();
    this.markCache.clear();
    this.colStarts.clear();
    this.pillsOf = null;
    this.firstOff = null;
  }

  get n() {
    return this.geo?.n ?? 1;
  }

  // ── Chapitres ─────────────────────────────────────────────

  private colEl(ch: number): HTMLElement | null {
    return (this.host.sections()[ch]?.firstElementChild as HTMLElement | null) ?? null;
  }

  private setChapter(ch: number) {
    const secs = this.host.sections();
    secs.forEach((sec, i) => {
      sec.classList.toggle('paged-cur', i === ch);
      sec.classList.toggle('paged-near', i !== ch && Math.abs(i - ch) === 1);
    });
    if (ch !== this.chapter) {
      const old = this.colEl(this.chapter);
      old?.getAnimations?.().forEach((a) => a.cancel());
    }
    this.chapter = ch;
    this.firstOff = null;
  }

  /** Nombre de pages d'écran (colonnes) du chapitre, qui doit être affiché ou voisin. */
  count(ch: number): number {
    const hit = this.counts.get(ch);
    if (hit != null) return hit;
    const root = this.host.roots()[ch];
    const col = this.colEl(ch);
    const g = this.geo;
    if (!root || !col || !g) return 1;
    const base = col.getBoundingClientRect().left;
    let max = 0;
    for (const r of Array.from(root.getClientRects())) {
      if (!r.width && !r.height) continue;
      max = Math.max(max, this.colOfX(r.left - base), this.colOfX(r.right - base - 1));
    }
    const c = max + 1;
    this.counts.set(ch, c);
    return c;
  }

  private colOfX(dx: number) {
    const g = this.geo!;
    return Math.max(0, Math.floor((dx + g.mx) / g.w));
  }

  /** Colonne (page d'écran) d'un rectangle du chapitre affiché. */
  colOfRect(ch: number, r: DOMRect): number {
    const col = this.colEl(ch);
    if (!col || !this.geo) return 0;
    return this.colOfX(r.left - col.getBoundingClientRect().left);
  }

  /** Nœuds texte non vides d'un chapitre, avec leur offset de départ. */
  private textNodes(ch: number): { node: Text; start: number }[] {
    const root = this.host.roots()[ch];
    const out: { node: Text; start: number }[] = [];
    if (!root) return out;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let n: Node | null;
    while ((n = w.nextNode())) {
      const t = n as Text;
      if (/\S/.test(t.data)) out.push({ node: t, start: pos });
      pos += t.data.length;
    }
    return out;
  }

  /** Colonne du premier caractère visible à partir de `i` dans le nœud (null : rien de rendu). */
  private colOfChar(ch: number, t: Text, i: number, base: number): number | null {
    const r = document.createRange();
    for (let k = i; k < t.data.length; k++) {
      if (/\s/.test(t.data[k])) continue;
      r.setStart(t, k);
      r.setEnd(t, k + 1);
      const rect = r.getClientRects()[0];
      if (rect && (rect.width || rect.height)) return this.colOfX(rect.left - base);
    }
    return null;
  }

  /** Colonne de l'offset `off` du chapitre (affiché). */
  colOfOffset(ch: number, off: number): number {
    const col = this.colEl(ch);
    if (!col || !this.geo) return 0;
    const base = col.getBoundingClientRect().left;
    const nodes = this.textNodes(ch);
    if (!nodes.length) return 0;
    let lo = 0;
    let hi = nodes.length - 1;
    let j = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].start <= off) {
        j = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let k = j; k < nodes.length; k++) {
      const local = k === j ? Math.max(0, off - nodes[k].start) : 0;
      if (local >= nodes[k].node.data.length) continue;
      const c = this.colOfChar(ch, nodes[k].node, local, base);
      if (c != null) return c;
    }
    return this.count(ch) - 1;
  }

  /** Offset du premier caractère de la page d'écran `k` du chapitre affiché. */
  startOffset(ch: number, k: number): number {
    if (k <= 0) return 0;
    const col = this.colEl(ch);
    if (!col || !this.geo) return 0;
    const base = col.getBoundingClientRect().left;
    const nodes = this.textNodes(ch);
    const colAt = (i: number) => this.colOfChar(ch, nodes[i].node, 0, base) ?? -1;
    // Dernier nœud qui commence avant la page k.
    let lo = 0;
    let hi = nodes.length - 1;
    let j = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (colAt(mid) < k) {
        j = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (j < 0) return 0;
    const t = nodes[j].node;
    // Dans ce nœud : premier caractère (non blanc) qui est sur la page k ou après.
    const r = document.createRange();
    let a = 0;
    let b = t.data.length - 1;
    let found = -1;
    while (a <= b) {
      const mid = (a + b) >> 1;
      let m = mid;
      while (m <= b && /\s/.test(t.data[m])) m++;
      if (m > b) {
        b = mid - 1;
        continue;
      }
      r.setStart(t, m);
      r.setEnd(t, m + 1);
      const rect = r.getClientRects()[0];
      const c = rect ? this.colOfX(rect.left - base) : -1;
      if (c >= k) {
        found = m;
        b = mid - 1;
      } else a = m + 1;
    }
    if (found >= 0) return nodes[j].start + found;
    return j + 1 < nodes.length ? nodes[j + 1].start : this.host.texts()[ch]?.length ?? 0;
  }

  /** Premier caractère visible (page de gauche de la double page). */
  firstOffset(): number {
    if (this.firstOff == null) this.firstOff = this.startOffset(this.chapter, this.page);
    return this.firstOff;
  }

  /** Offset juste après la dernière page visible (borne exclue). */
  endOffset(): number {
    const k = this.page + this.n;
    if (k >= this.count(this.chapter)) return this.host.texts()[this.chapter]?.length ?? 0;
    return this.startOffset(this.chapter, k);
  }

  atEnd(): boolean {
    return this.chapter >= this.host.sections().length - 1 && this.page + this.n >= this.count(this.chapter);
  }

  // ── Afficher ──────────────────────────────────────────────

  /** Montre la double page qui contient la colonne k du chapitre ch. */
  show(ch: number, k: number, dir: -1 | 0 | 1 = 0, user = false) {
    const g = this.geo;
    const secs = this.host.sections();
    if (!g || !secs.length) return;
    ch = clamp(ch, 0, secs.length - 1);
    const changed = ch !== this.chapter || !secs[ch].classList.contains('paged-cur');
    if (changed) this.setChapter(ch);
    const cnt = this.count(ch);
    k = clamp(k, 0, cnt - 1);
    k = Math.floor(k / g.n) * g.n;
    const moved = changed || k !== this.page;
    this.page = k;
    this.firstOff = null;
    const col = this.colEl(ch);
    if (col) {
      const x = -k * g.w;
      col.getAnimations?.().forEach((a) => a.cancel());
      col.style.transform = `translateX(${x}px)`;
      if (dir && moved && !reduceMotion()) {
        // Page tournée : le texte arrive en glissant légèrement du côté où l'on va.
        col.animate(
          [
            { opacity: 0.25, transform: `translateX(${x + dir * 28}px)` },
            { opacity: 1, transform: `translateX(${x}px)` },
          ],
          { duration: TURN_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        );
        this.sheets.forEach((s) => {
          s.classList.remove('turn-next', 'turn-prev');
          void s.offsetWidth;
          s.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
        });
      }
    }
    if (moved) this.pinnedLabel = null;
    if (user) this.keep = null;
    this.paint();
    this.host.onShown({ chapterChanged: changed, user });
  }

  next(user = true) {
    const cnt = this.count(this.chapter);
    if (this.page + this.n < cnt) this.show(this.chapter, this.page + this.n, 1, user);
    else if (this.chapter < this.host.sections().length - 1) this.show(this.chapter + 1, 0, 1, user);
    else this.bump(1);
  }

  prev(user = true) {
    if (this.page > 0) this.show(this.chapter, this.page - this.n, -1, user);
    else if (this.chapter > 0) {
      const ch = this.chapter - 1;
      this.setChapter(ch);
      this.show(ch, this.count(ch) - 1, -1, user);
    } else this.bump(-1);
  }

  private bump(dir: number) {
    if (reduceMotion()) return;
    this.spreadEl.animate([{ transform: 'none' }, { transform: `translateX(${-dir * 6}px)` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
  }

  /** Montre la page d'un offset (sans animation si dir = 0). */
  revealOffset(ch: number, off: number, dir: -1 | 0 | 1 = 0) {
    if (!this.geo) return;
    if (ch !== this.chapter || !this.host.sections()[ch]?.classList.contains('paged-cur')) this.setChapter(ch);
    this.show(ch, this.colOfOffset(ch, off), dir);
    this.keep = { chapter: ch, offset: off };
  }

  /** Passage à garder à l'écran lors d'une remise en page : celui visé, sinon le début de la page. */
  anchor(): { chapter: number; offset: number } {
    const k = this.keep;
    if (k && k.chapter === this.chapter && k.offset >= this.firstOffset() && k.offset < this.endOffset()) return k;
    return { chapter: this.chapter, offset: this.firstOffset() };
  }

  /** Montre la page d'un rectangle (calculé une fois le chapitre affiché). */
  revealRect(ch: number, rectOf: () => DOMRect | null, animate = true) {
    if (!this.geo) return;
    if (ch !== this.chapter || !this.host.sections()[ch]?.classList.contains('paged-cur')) this.setChapter(ch);
    const r = rectOf();
    const k = r && (r.width || r.height) ? this.colOfRect(ch, r) : 0;
    const visible = ch === this.chapter && k >= this.page && k < this.page + this.n;
    const dir: -1 | 0 | 1 = !animate || visible ? 0 : k < this.page ? -1 : 1;
    this.show(ch, k, dir);
  }

  /** La colonne k du chapitre ch est-elle visible ? */
  isVisible(ch: number, k: number) {
    return ch === this.chapter && k >= this.page && k < this.page + this.n;
  }

  // ── Folios, pastilles de marge et titres courants ─────────
  //
  // Folio d'une page d'écran : la page du livre en cours à son PREMIER caractère (un seul numéro,
  // jamais « 1–2 » ; il se répète si plusieurs pages d'écran tombent dans la même page du livre).
  // Une page du livre qui commence plus bas dans la page d'écran est signalée, comme en défilement
  // continu, par une pastille numérotée dans la marge extérieure, à la hauteur de la ligne, et une
  // encoche au mot exact (calque .paged-marks de la colonne, couleurs de .pg-number, page-marks.css).

  /** Premier caractère non blanc à partir de `off` (ou la fin du chapitre). */
  private skipBlank(ch: number, off: number): number {
    const t = this.host.texts()[ch] ?? '';
    while (off < t.length && /\s/.test(t[off])) off++;
    return off;
  }

  /** Offset du premier caractère (non blanc) de la page d'écran k. */
  colStart(ch: number, k: number): number {
    const key = `${ch}:${k}`;
    const hit = this.colStarts.get(key);
    if (hit != null) return hit;
    const v = this.skipBlank(ch, this.startOffset(ch, k));
    this.colStarts.set(key, v);
    return v;
  }

  /** Rectangle du caractère à l'offset `off` du chapitre (null : pas de texte rendu là). */
  private charRectAt(ch: number, off: number): DOMRect | null {
    const nodes = this.textNodes(ch);
    let lo = 0;
    let hi = nodes.length - 1;
    let j = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].start <= off) {
        j = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (j < 0) return null;
    const t = nodes[j].node;
    const i = off - nodes[j].start;
    if (i >= t.data.length) return null;
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 1);
    const rect = r.getClientRects()[0];
    return rect && (rect.width || rect.height) ? rect : null;
  }

  /** Offset de chaque repère de page du chapitre (le repère est un <span> vide). */
  private markOffsets(ch: number): Map<Element, number> {
    const root = this.host.roots()[ch];
    const out = new Map<Element, number>();
    if (!root) return out;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let pos = 0;
    let n: Node | null;
    while ((n = w.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) pos += (n as Text).data.length;
      else if ((n as Element).classList.contains('pg-mark')) out.set(n as Element, pos);
    }
    return out;
  }

  private markPositions(ch: number): MarkPos[] {
    const hit = this.markCache.get(ch);
    if (hit) return hit;
    const marks = this.host.marks();
    const first = this.host.firstMark();
    const col = this.colEl(ch);
    const g = this.geo;
    const out: MarkPos[] = [];
    if (col && g && first.length > ch + 1) {
      const cr = col.getBoundingClientRect();
      const offs = this.markOffsets(ch);
      for (let i = first[ch]; i < first[ch + 1]; i++) {
        const el = marks[i];
        const off = this.skipBlank(ch, offs.get(el) ?? 0);
        // Début de chapitre (ou du livre) : la première page d'écran, quelle que soit la place du repère.
        if (/pg-chap|pg-start/.test(el.className)) {
          out.push({ index: i, off, col: 0, y: 0, atTop: true, tick: null });
          continue;
        }
        // La ligne où commence la page : celle de son premier caractère (sinon, le repère lui-même).
        const cr0 = this.charRectAt(ch, off);
        const r = cr0 ?? el.getBoundingClientRect();
        const k = this.colOfX(r.left - cr.left);
        // L'encoche est dessinée devant le premier caractère de la page, et non par la bordure du
        // repère : un <span> vide après une espace peut rester en fin de ligne précédente.
        const tick = cr0 && el.classList.contains('pg-inline') ? { x: cr0.left - cr.left, top: cr0.top - cr.top + cr0.height * 0.2, h: cr0.height * 0.6 } : null;
        out.push({ index: i, off, col: k, y: r.top - cr.top + r.height / 2, atTop: off <= this.colStart(ch, k), tick });
      }
    }
    this.markCache.set(ch, out);
    return out;
  }

  /** Page du livre (indice) en cours au premier caractère de la page d'écran k (-1 : aucune). */
  pageAtStart(ch: number, k: number): number {
    const pos = this.markPositions(ch);
    const s = this.colStart(ch, k);
    let ans = (this.host.firstMark()[ch] ?? 0) - 1;
    for (const p of pos) {
      if (p.off <= s && p.col <= k) ans = p.index;
      else break;
    }
    return ans;
  }

  /** Pages du livre (indices) présentes sur la page d'écran k : celle du haut, puis celles qui y commencent. */
  pagesOf(ch: number, k: number): number[] {
    const a = this.pageAtStart(ch, k);
    const out = a >= 0 ? [a] : [];
    for (const p of this.markPositions(ch)) if (p.col === k && !p.atTop && p.index !== a) out.push(p.index);
    return out;
  }

  /** Page du livre lue : celle du premier caractère de la page de gauche (ou celle demandée, si visible). */
  pageIndexAtView(): number {
    const g = this.geo;
    if (!g) return -1;
    if (this.pinnedLabel != null) {
      for (let i = 0; i < g.n; i++) if (this.pagesOf(this.chapter, this.page + i).includes(this.pinnedLabel)) return this.pinnedLabel;
      this.pinnedLabel = null;
    }
    return this.pageAtStart(this.chapter, this.page);
  }

  private folioText(ch: number, k: number): string {
    const labels = this.host.labels();
    if (!labels.length) return String(k + 1); // document sans pages : numérotation des pages d'écran
    const i = this.pageAtStart(ch, k);
    return i >= 0 ? labels[i] ?? '' : '';
  }

  private clearPills() {
    for (const el of Array.from(this.host.doc.querySelectorAll('.paged-marks'))) el.remove();
    this.pillsOf = null;
  }

  /**
   * Pastilles de marge du chapitre lu : une par page du livre qui commence ailleurs qu'en haut d'une
   * page d'écran, dans la marge extérieure (gauche sur la page de gauche d'une double page, droite
   * sinon), à la hauteur de sa première ligne. Calque dans la colonne : il tourne avec le texte.
   */
  private paintPills() {
    const g = this.geo;
    const ch = this.chapter;
    if (!g || this.pillsOf === ch) return;
    this.clearPills();
    const col = this.colEl(ch);
    const labels = this.host.labels();
    if (!col || !labels.length) return;
    const layer = document.createElement('div');
    layer.className = 'paged-marks';
    layer.setAttribute('aria-hidden', 'true');
    for (const p of this.markPositions(ch)) {
      if (p.tick) {
        const t = document.createElement('span');
        t.className = 'paged-tick';
        t.dataset.pgIndex = String(p.index);
        t.style.cssText = `left:${p.tick.x.toFixed(1)}px;top:${p.tick.top.toFixed(1)}px;height:${p.tick.h.toFixed(1)}px`;
        layer.appendChild(t);
      }
      if (p.atTop) continue;
      const left = g.n === 2 && p.col % 2 === 0;
      const pill = document.createElement('span');
      pill.className = `paged-pill ${left ? 'is-left' : 'is-right'}`;
      pill.textContent = labels[p.index] ?? '';
      pill.dataset.pgIndex = String(p.index);
      pill.dataset.col = String(p.col);
      pill.style.top = `${Math.round(p.y)}px`;
      // Centre de la marge extérieure de la page d'écran p.col (repère : bord gauche de la colonne 0).
      const x = left ? p.col * g.w - g.mx / 2 : p.col * g.w + g.cw + g.mx / 2;
      pill.style.left = `${Math.round(x)}px`;
      layer.appendChild(pill);
    }
    col.appendChild(layer);
    this.pillsOf = ch;
  }

  private parity(label: string, k: number) {
    const t = label.trim();
    const v = /^[0-9]+$/.test(t) ? Number(t) : romanToInt(t);
    return (v ?? k + 1) % 2;
  }

  /** Feuilles : titre courant (pas sur la page qui ouvre un chapitre), folio, page blanche ; pastilles. */
  paint() {
    const g = this.geo;
    if (!g) return;
    this.paintPills();
    const ch = this.chapter;
    const cnt = this.count(ch);
    const book = this.host.bookTitle();
    const chap = this.host.chapterTitle(ch) || book;
    this.sheets.forEach((sheet, i) => {
      const k = this.page + i;
      const head = sheet.firstElementChild as HTMLElement;
      const folio = sheet.lastElementChild as HTMLElement;
      const blank = k >= cnt;
      sheet.classList.toggle('is-blank', blank);
      sheet.classList.toggle('is-opening', k === 0);
      const f = blank ? '' : this.folioText(ch, k);
      folio.textContent = f;
      let h = '';
      if (!blank && k > 0) {
        if (g.n === 2) h = i === 0 ? book || chap : chap;
        else h = this.parity(f, k) === 0 ? book || chap : chap;
      }
      head.textContent = h;
      head.title = h;
    });
  }

  // ── Entrées : clavier, molette, clic dans les marges ──────

  private activePane(): boolean {
    const { scroll } = this.host;
    if (!scroll.isConnected) return false;
    const split = scroll.closest('.reader-panes.is-split');
    if (split && !scroll.closest('.reader-page')?.classList.contains('is-focused')) return false;
    // Un autre écran recouvre le lecteur (palette, dialogue) : ne rien faire.
    if (document.querySelector('.cmd-overlay')) return false;
    return true;
  }

  private onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditing(e.target) || !this.activePane()) return;
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) dir = -1;
    if (!dir) return;
    e.preventDefault();
    if (dir > 0) this.next();
    else this.prev();
  }

  private wheelAcc = 0;
  private wheelLast = 0;
  private wheelLocked = false;

  private onWheel(e: WheelEvent) {
    if (e.ctrlKey) return; // pincement (zoom)
    // Horodatage de l'évènement (pas l'heure de traitement) : une page tournée qui occupe le fil
    // principal ne doit pas faire croire à un nouveau geste.
    const now = e.timeStamp;
    if (now - this.wheelLast > WHEEL_IDLE) {
      this.wheelAcc = 0;
      this.wheelLocked = false;
    }
    this.wheelLast = now;
    if (this.wheelLocked) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const horiz = Math.abs(dx) > Math.abs(dy);
    this.wheelAcc += horiz ? dx : dy;
    if (Math.abs(this.wheelAcc) < (horiz ? 50 : 70)) return;
    // Un geste (ou un cran) = une page ; l'inertie du pavé tactile ne tourne pas la suivante.
    this.wheelLocked = true;
    if (this.wheelAcc > 0) this.next();
    else this.prev();
  }

  /** Zone de clic : marge extérieure gauche (page précédente) ou droite (suivante). */
  zoneAt(x: number): 'prev' | 'next' | '' {
    const g = this.geo;
    if (!g) return '';
    const sx = x - this.host.scroll.getBoundingClientRect().left;
    const left = g.left + g.mx * 0.85;
    const right = g.left + g.n * g.w - g.mx * 0.85;
    if (sx < left) return 'prev';
    if (sx > right) return 'next';
    return '';
  }

  private setZone(z: string) {
    const { scroll } = this.host;
    if ((scroll.dataset.zone ?? '') === z) return;
    if (z) scroll.dataset.zone = z;
    else delete scroll.dataset.zone;
  }

  private onMove(e: MouseEvent) {
    if (e.buttons) return this.setZone('');
    this.setZone(this.zoneAt(e.clientX));
  }

  /** Clic dans une marge : tourne la page. Renvoie true si le clic a été consommé. */
  clickTurn(x: number): boolean {
    const z = this.zoneAt(x);
    if (z === 'prev') this.prev();
    else if (z === 'next') this.next();
    return !!z;
  }
}
