// Lien citation → extrait.
//
// Une citation insérée depuis le panneau Extraits est entourée d'un signet Word nommé
// `_mglHl_<highlightId>` (w:bookmarkStart / w:bookmarkEnd autour du texte cité, avant
// l'appel de note). Le signet survit à l'enregistrement et à la réouverture ; il est retiré
// de tous les exports par privateNotes.ts (stripDocumentXml).
//
// ⌘-clic sur la citation (ou le bouton de la petite barre qui apparaît au survol) ouvre
// le livre à cet extrait. Si l'extrait a été supprimé : message clair (et « Restaurer »
// s'il est encore dans la corbeille).
import { useStore } from '../../lib/store';
import type { DocEngine } from './engine';
import { CITE_BOOKMARK_PREFIX } from './privateNotes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const pmEditor = (e: DocEngine | null): Any => (e ? (e.debugEditor() as Any)?.editor : null);

export interface CiteRange {
  highlightId: string;
  /** Position du signet de début (avant le texte). */
  from: number;
  /** Position du signet de fin (après le texte). */
  to: number;
}

/** Citations liées du document (signets `_mglHl_…`), dans l'ordre. */
export function citationRanges(engine: DocEngine | null): CiteRange[] {
  const ed = pmEditor(engine);
  if (!ed) return [];
  const starts = new Map<string, { hl: string; from: number }>();
  const out: CiteRange[] = [];
  ed.state.doc.descendants((n: Any, pos: number) => {
    const t = n.type.name;
    if (t === 'bookmarkStart' && typeof n.attrs.name === 'string' && n.attrs.name.startsWith(CITE_BOOKMARK_PREFIX)) {
      starts.set(String(n.attrs.id), { hl: n.attrs.name.slice(CITE_BOOKMARK_PREFIX.length), from: pos });
    } else if (t === 'bookmarkEnd') {
      const s = starts.get(String(n.attrs.id));
      if (s) {
        out.push({ highlightId: s.hl, from: s.from, to: pos });
        starts.delete(String(n.attrs.id));
      }
    }
    return true;
  });
  return out;
}

export function citationAt(engine: DocEngine | null, pos: number): CiteRange | null {
  return citationRanges(engine).find((r) => pos > r.from && pos <= r.to) ?? null;
}

/**
 * Entoure d'un signet la citation que `insertCitation` vient d'insérer (le curseur est alors
 * dans le paragraphe vide qui la suit). Renvoie false si la citation n'est pas retrouvée.
 */
export function tagInsertedCitation(engine: DocEngine | null, highlightId: string, quote: string): boolean {
  const ed = pmEditor(engine);
  if (!ed) return false;
  const { doc, schema } = ed.state;
  if (!schema.nodes.bookmarkStart || !schema.nodes.bookmarkEnd) return false;
  const caret = ed.state.selection.from;
  // Paragraphe de citation le plus proche avant le curseur dont le texte commence par la citation.
  let para: { node: Any; pos: number } | null = null;
  doc.descendants((n: Any, pos: number) => {
    if (pos > caret) return false;
    if (n.type.name === 'paragraph') {
      if (n.textContent.startsWith(quote)) para = { node: n, pos };
      return false;
    }
    return true;
  });
  if (!para) return false;
  const { node, pos } = para as { node: Any; pos: number };
  // Enfants porteurs du texte cité (runs de texte), jusqu'à l'appel de note exclu.
  let start = -1;
  let end = -1;
  let len = 0;
  node.forEach((child: Any, offset: number) => {
    if (end >= 0 && len >= quote.length) return;
    let hasNote = false;
    child.descendants?.((x: Any) => {
      if (x.type.name === 'footnoteReference') hasNote = true;
      return true;
    });
    if (hasNote || child.type.name === 'footnoteReference') {
      if (start >= 0 && end < 0) end = pos + 1 + offset;
      len = quote.length;
      return;
    }
    if (!child.textContent) return;
    if (start < 0) start = pos + 1 + offset;
    len += child.textContent.length;
    if (len >= quote.length && end < 0) end = pos + 1 + offset + child.nodeSize;
  });
  if (start < 0) return false;
  if (end < 0) end = pos + 1 + node.content.size;
  // Identifiant numérique unique (Word exige un entier).
  let maxId = 9000;
  doc.descendants((n: Any) => {
    if (n.type.name === 'bookmarkStart' || n.type.name === 'bookmarkEnd') {
      const v = Number(n.attrs.id);
      if (Number.isFinite(v) && v > maxId) maxId = v;
    }
    return true;
  });
  const id = String(maxId + 1);
  try {
    const tr = ed.state.tr;
    tr.insert(end, schema.nodes.bookmarkEnd.create({ id }));
    tr.insert(start, schema.nodes.bookmarkStart.create({ id, name: CITE_BOOKMARK_PREFIX + highlightId }));
    tr.setMeta('addToHistory', true);
    ed.view.dispatch(tr);
    return true;
  } catch (e) {
    console.warn('signet de citation', e);
    return false;
  }
}

/** Ouvre le livre à l'extrait ; message clair si l'extrait (ou son livre) n'existe plus. */
export function openCitedExtract(highlightId: string): boolean {
  const s = useStore.getState();
  const h = s.highlights.find((x) => x.id === highlightId);
  if (h && s.books.some((b) => b.id === h.bookId)) {
    s.jumpToHighlight(highlightId);
    return true;
  }
  const inTrash = s.trash.find((t) => t.changes.some((c) => c.col === 'highlights' && c.id === highlightId && c.after == null && c.before != null));
  if (inTrash) {
    s.toast('L’extrait cité a été supprimé : il est dans la corbeille.', 'info', {
      label: 'Restaurer',
      run: () => {
        const r = useStore.getState().restoreFromTrash(inTrash.id);
        if (r.ok && useStore.getState().highlights.some((x) => x.id === highlightId)) useStore.getState().jumpToHighlight(highlightId);
      },
    });
  } else if (h) {
    s.toast('Le livre de cet extrait a été supprimé : impossible de l’ouvrir.', 'error');
  } else {
    s.toast('L’extrait cité a été supprimé définitivement : la citation reste dans votre texte, sans lien.', 'error');
  }
  return false;
}

// ── Interaction : ⌘-clic et barre au survol ──────────────────
export interface CiteHover {
  highlightId: string;
  rect: DOMRect;
}

/** Position du document sous un élément peint (span de texte SuperDoc). */
function pmPosOf(el: Element | null): number | null {
  const run = el?.closest?.('[data-pm-start]') as HTMLElement | null;
  if (!run) return null;
  const story = run.closest('[data-layout-story]')?.getAttribute('data-layout-story');
  if (story && story !== 'body') return null;
  const a = Number(run.dataset.pmStart);
  const b = Number(run.dataset.pmEnd);
  if (!Number.isFinite(a)) return null;
  return Number.isFinite(b) && b > a ? Math.floor((a + b) / 2) : a + 1;
}

/** Rectangle englobant les spans peints d'une citation, sur la page du premier. */
function rectOf(host: HTMLElement, r: CiteRange): DOMRect | null {
  const spans = Array.from(host.querySelectorAll<HTMLElement>('span[data-pm-start]')).filter((s) => {
    const a = Number(s.dataset.pmStart);
    return a >= r.from && a < r.to && (s.closest('[data-layout-story]')?.getAttribute('data-layout-story') ?? 'body') === 'body';
  });
  if (!spans.length) return null;
  const rects = spans.map((s) => s.getBoundingClientRect()).filter((x) => x.width > 0);
  if (!rects.length) return null;
  const top = Math.min(...rects.map((x) => x.top));
  const left = Math.min(...rects.map((x) => x.left));
  const right = Math.max(...rects.map((x) => x.right));
  const bottom = Math.max(...rects.map((x) => x.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Branche ⌘-clic et survol sur l'hôte de l'éditeur. `onHover` reçoit la citation survolée
 * (ou null). Renvoie la fonction de nettoyage.
 */
export function attachCiteLinks(host: HTMLElement, getEngine: () => DocEngine | null, onHover: (h: CiteHover | null) => void): () => void {
  let hoverId: string | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  const citeUnder = (target: EventTarget | null): CiteRange | null => {
    const pos = pmPosOf(target as Element | null);
    return pos == null ? null : citationAt(getEngine(), pos);
  };
  const onDown = (ev: PointerEvent) => {
    if (!(ev.metaKey || ev.ctrlKey) || ev.button !== 0) return;
    const c = citeUnder(ev.target);
    if (!c) return;
    ev.preventDefault();
    ev.stopPropagation();
    openCitedExtract(c.highlightId);
  };
  const swallow = (ev: MouseEvent) => {
    if ((ev.metaKey || ev.ctrlKey) && citeUnder(ev.target)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };
  const onMove = (ev: PointerEvent) => {
    const target = ev.target;
    const meta = ev.metaKey || ev.ctrlKey;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const c = citeUnder(target);
      host.classList.toggle('ed-cite-meta', !!c && meta);
      if (c) {
        if (leaveTimer) clearTimeout(leaveTimer);
        leaveTimer = null;
        if (hoverId === c.highlightId + ':' + c.from) return;
        const rect = rectOf(host, c);
        if (!rect) return;
        hoverId = c.highlightId + ':' + c.from;
        onHover({ highlightId: c.highlightId, rect });
      } else if (hoverId && !leaveTimer) {
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          hoverId = null;
          onHover(null);
        }, 450);
      }
    });
  };
  const keep = () => {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = null;
  };
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('mousedown', swallow, true);
  host.addEventListener('click', swallow, true);
  host.addEventListener('pointermove', onMove, { passive: true });
  const scroller = host.closest('.ed-scroll');
  const hide = () => {
    hoverId = null;
    onHover(null);
  };
  scroller?.addEventListener('scroll', hide, { passive: true });
  // La barre elle-même garde l'affichage (elle est hors de l'hôte) ; ailleurs, on la retire.
  const onOver = (ev: PointerEvent) => {
    const t = ev.target as Element | null;
    if (t?.closest?.('.ed-citebar')) keep();
    else if (hoverId && !host.contains(t) && !leaveTimer) {
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        hoverId = null;
        onHover(null);
      }, 450);
    }
  };
  document.addEventListener('pointerover', onOver, true);
  return () => {
    cancelAnimationFrame(frame);
    if (leaveTimer) clearTimeout(leaveTimer);
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('mousedown', swallow, true);
    host.removeEventListener('click', swallow, true);
    host.removeEventListener('pointermove', onMove);
    scroller?.removeEventListener('scroll', hide);
    document.removeEventListener('pointerover', onOver, true);
  };
}
