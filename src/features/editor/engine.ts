// ─────────────────────────────────────────────────────────────
// DocEngine : seule frontière avec SuperDoc 1.47.2 (AGPL-3.0, branche legacy).
// Remplacer le moteur (ex. eigenpal) ne doit toucher que ce fichier.
//
// Chargement : la build ES de `superdoc` importe `yjs` et `@hocuspocus/provider`
// (dépendances pairs non installées : .npmrc legacy-peer-deps), ce qui casse Vite.
// On charge donc la build autonome IIFE `superdoc.min.js` (copiée telle quelle comme
// asset par Vite via `?url`) dans une balise <script>, à la demande.
// G4 : télémétrie coupée, aucune police distante, aucun service de correction.
// ─────────────────────────────────────────────────────────────
import superdocUrl from '../../../node_modules/superdoc/dist/superdoc.min.js?url';
// CSS du moteur : chargé seulement avec ce module (chunk paresseux), dans `@layer superdoc`
// (priorité inférieure aux styles de l'app) ; il ne déclare que des classes préfixées et
// des variables --sd-* (vérifié).
import 'superdoc/style.layered.css';
import { countWords } from './docx';

export type ParaStyle = 'h1' | 'h2' | 'h3' | 'body' | 'quote';
export type MarkName = 'bold' | 'italic' | 'underline';

export interface OutlineItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

export interface EngineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  style: ParaStyle | 'other';
  list: boolean;
  /** Position du curseur (pour surligner le titre courant du plan). */
  pos: number;
}

export interface EngineStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
}

export interface DocEngine {
  /** Exporte le document courant en .docx (OOXML natif). */
  exportDocx(): Promise<ArrayBuffer>;
  /** Texte brut du corps, paragraphes séparés par des sauts de ligne (secours, G2). */
  plainText(): string;
  wordCount(): number;
  stats(): EngineStats;
  outline(): OutlineItem[];
  state(): EngineState;
  setParagraphStyle(s: ParaStyle): void;
  toggleMark(m: MarkName): void;
  toggleList(kind: 'bullet' | 'ordered'): void;
  /** Insère une note à l'emplacement du curseur et place la saisie dans la note. */
  insertFootnote(): boolean;
  /** Insère `quote` en paragraphe de style Citation suivi d'une note portant `note`. */
  insertCitation(quote: string, note: string): boolean;
  /** Insère des paragraphes de corps (texte brut) à la fin du document — tests et outils. */
  appendParagraph(text: string): void;
  undo(): void;
  redo(): void;
  goTo(pos: number): void;
  /** Lecture seule (garde-fou G2 à l'ouverture). */
  setEditable(on: boolean): void;
  focus(): void;
  destroy(): void;
}

export interface EngineOptions {
  /** Le contenu a changé (corps ou note). */
  onChange?: () => void;
  /** Sélection / mise en forme courante changée. */
  onSelection?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

let loading: Promise<Any> | null = null;
function loadSuperDoc(): Promise<Any> {
  const w = window as Any;
  if (w.SuperDoc) return Promise.resolve(w.SuperDoc);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = superdocUrl;
    s.async = true;
    s.dataset.marginalia = 'superdoc';
    s.onload = () => (w.SuperDoc ? resolve(w.SuperDoc) : reject(new Error('SuperDoc introuvable après chargement')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Impossible de charger le moteur d’édition'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const QUOTE_IDS = ['Quote', 'BlockText', 'IntenseQuote', 'Citation'];
const QUOTE_NAMES = ['quote', 'block text', 'intense quote', 'citation'];

/** Ouvre `data` (.docx) dans `host`. Rejette si le moteur ne devient pas prêt. */
export async function openDocEngine(host: HTMLElement, data: ArrayBuffer, opts: EngineOptions = {}): Promise<DocEngine> {
  const SuperDoc = await loadSuperDoc();
  const file = new File([data], 'document.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  let destroyed = false;
  let ready = false;
  // Les transactions de normalisation qui suivent l'ouverture ne sont pas des modifications ;
  // mais une saisie de l'utilisateur pendant cette fenêtre doit compter (sinon elle ne serait
  // jamais enregistrée). Le ProseMirror caché de SuperDoc vit hors de `host` : écoute globale.
  let touched = false;
  const onUserInput = (e: Event) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('.ProseMirror')) touched = true;
  };
  const INPUT_EVENTS = ['beforeinput', 'paste', 'drop', 'cut'] as const;
  for (const ev of INPUT_EVENTS) document.addEventListener(ev, onUserInput, true);
  const live = () => !destroyed && (ready || touched);
  const sd: Any = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le document met trop de temps à s’ouvrir')), 45000);
    let inst: Any = null;
    try {
      inst = new SuperDoc({
        selector: host,
        document: file,
        documentMode: 'editing',
        telemetry: { enabled: false },
        proofing: { enabled: false },
        disablePiniaDevtools: true,
        disableContextMenu: true,
        rulers: false,
        user: { name: 'Marginalia', email: '' },
        zoom: { mode: 'fit-width', fitWidth: { min: 55, max: 100, padding: 32 } },
        onReady: () => {
          clearTimeout(timer);
          // les transactions de normalisation qui suivent l'ouverture ne comptent pas comme modifications
          setTimeout(() => (ready = true), 600);
          resolve(inst);
        },
        onEditorUpdate: () => {
          if (live()) opts.onChange?.();
        },
        onTransaction: (p: Any) => {
          if (!live()) return;
          // couvre aussi les éditeurs de notes (sessions de saisie de note de bas de page)
          if (p?.transaction?.docChanged) opts.onChange?.();
          opts.onSelection?.();
        },
        onContentError: (p: Any) => {
          clearTimeout(timer);
          reject(p?.error instanceof Error ? p.error : new Error('Document illisible'));
        },
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  }).catch((e) => {
    for (const ev of INPUT_EVENTS) document.removeEventListener(ev, onUserInput, true);
    throw e;
  });

  // Attendre que la première page soit peinte (sinon l'interface montrerait une zone vide
  // entre la fin du squelette et l'apparition de la page). Borné : 4 s.
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (host.querySelector('.superdoc-page') || performance.now() - t0 > 4000) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });

  /** Éditeur du corps (pas la session de note éventuellement active). */
  const body = (): Any => {
    const docs = sd.superdocStore?.documents;
    const e = docs?.[0]?.getEditor?.() ?? sd.activeEditor;
    return e;
  };
  const pres = (): Any => {
    const docs = sd.superdocStore?.documents;
    return docs?.[0]?.getPresentationEditor?.() ?? body()?.presentationEditor ?? null;
  };

  // ── Styles disponibles dans le document ──
  const styleMap = (): Map<string, string> => {
    const out = new Map<string, string>();
    const ls: Any[] = body()?.converter?.linkedStyles ?? [];
    for (const s of ls) if (s?.type === 'paragraph' && s.id) out.set(String(s.id), String(s.definition?.attrs?.name ?? s.id).toLowerCase());
    return out;
  };
  const resolveStyleId = (s: ParaStyle): string | null => {
    const map = styleMap();
    if (s === 'body') return null;
    if (s === 'quote') {
      for (const id of QUOTE_IDS) if (map.has(id)) return id;
      for (const [id, name] of map) if (QUOTE_NAMES.includes(name)) return id;
      return null; // pas de style Citation : mise en forme directe
    }
    const n = s === 'h1' ? 1 : s === 'h2' ? 2 : 3;
    if (map.has(`Heading${n}`)) return `Heading${n}`;
    for (const [id, name] of map) if (name === `heading ${n}` || name === `titre ${n}`) return id;
    return `Heading${n}`;
  };
  const kindOfStyle = (styleId: string | null | undefined, pp: Any): ParaStyle | 'other' => {
    if (!styleId) return pp?.indent?.left && pp?.indent?.right ? 'quote' : 'body';
    const m = styleId.match(/^(?:Heading|Titre)(\d)$/);
    const name = styleMap().get(styleId) ?? '';
    const nm = name.match(/^(?:heading|titre) (\d)$/);
    const lvl = m ? Number(m[1]) : nm ? Number(nm[1]) : 0;
    if (lvl === 1) return 'h1';
    if (lvl === 2) return 'h2';
    if (lvl === 3) return 'h3';
    if (lvl > 3) return 'other';
    if (QUOTE_IDS.includes(styleId) || QUOTE_NAMES.includes(name)) return 'quote';
    if (/^(Normal|BodyText|FirstParagraph|Compact|Corpsdetexte)$/.test(styleId) || /^(normal|body text|first paragraph)$/.test(name)) return 'body';
    return 'other';
  };

  /** Profondeur du paragraphe englobant la sélection. */
  const paraDepth = ($pos: Any): number => {
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'paragraph') return d;
    return -1;
  };

  /** Ramène le curseur à l'intérieur d'un run (sinon la note serait hors <w:r>, OOXML invalide). */
  const caretIntoRun = (ed: Any) => {
    const { state } = ed;
    const $h = state.selection.$head;
    if ($h.parent.type.name === 'run') return;
    let target = -1;
    if ($h.nodeBefore?.type.name === 'run' && $h.nodeBefore.content.size > 0) target = $h.pos - 1;
    else if ($h.nodeAfter?.type.name === 'run') target = $h.pos + 1;
    else {
      // paragraphe sans run : on y crée un run vide n'est pas possible (texte requis) → fin du texte le plus proche
      state.doc.nodesBetween(Math.max(0, $h.pos - 200), $h.pos, (n: Any, p: Any) => {
        if (n.isText) target = p + n.nodeSize;
        return true;
      });
    }
    if (target >= 0) ed.commands.setTextSelection({ from: target, to: target });
  };

  const textblocks = (): string[] => {
    const out: string[] = [];
    body()?.state.doc.descendants((n: Any) => {
      if (n.isTextblock) {
        out.push(n.textContent);
        return false;
      }
      return true;
    });
    return out;
  };

  const engine: DocEngine = {
    async exportDocx() {
      const blob: Blob = await sd.export({ exportType: ['docx'], commentsType: 'external', triggerDownload: false });
      return blob.arrayBuffer();
    },
    plainText() {
      return textblocks().join('\n');
    },
    wordCount() {
      return countWords(textblocks().join('\n'));
    },
    stats() {
      const t = textblocks().join('\n');
      return { words: countWords(t), chars: t.replace(/\n/g, '').length, charsNoSpaces: t.replace(/\s/g, '').length };
    },
    outline() {
      const out: OutlineItem[] = [];
      body()?.state.doc.descendants((n: Any, pos: number) => {
        if (n.type.name === 'paragraph') {
          const pp = n.attrs.paragraphProperties;
          const k = kindOfStyle(pp?.styleId, pp);
          const text = n.textContent.trim();
          if (text && (k === 'h1' || k === 'h2' || k === 'h3')) out.push({ level: Number(k[1]) as 1 | 2 | 3, text, pos });
          return false;
        }
        return true;
      });
      return out;
    },
    state() {
      const ed = body();
      const st: EngineState = { bold: false, italic: false, underline: false, style: 'body', list: false, pos: 0 };
      if (!ed) return st;
      const { selection, storedMarks } = ed.state;
      st.pos = selection.from;
      const marks: Any[] = storedMarks ?? selection.$from.marks();
      for (const m of marks) {
        const n = m.type.name;
        if (n === 'bold') st.bold = true;
        if (n === 'italic') st.italic = true;
        if (n === 'underline') st.underline = true;
      }
      const d = paraDepth(selection.$from);
      if (d > 0) {
        const p = selection.$from.node(d);
        const pp = p.attrs.paragraphProperties;
        st.style = kindOfStyle(pp?.styleId, pp);
        st.list = !!pp?.numberingProperties;
      }
      return st;
    },
    setParagraphStyle(s) {
      touched = true;
      const ed = body();
      if (!ed) return;
      // NB : commands.setStyleById efface gras / italique du paragraphe (constaté) ;
      // on ne change donc que l'identifiant de style du ou des paragraphes sélectionnés.
      const styleId = resolveStyleId(s);
      const { state } = ed;
      const { from, to } = state.selection;
      let tr = state.tr;
      state.doc.nodesBetween(from, to, (n: Any, pos: number) => {
        if (n.type.name !== 'paragraph') return true;
        const pp = { ...(n.attrs.paragraphProperties ?? {}) };
        if (styleId) pp.styleId = styleId;
        else delete pp.styleId;
        if (s === 'quote' && !styleId) pp.indent = { ...(pp.indent ?? {}), left: 851, right: 567 };
        else if (pp.indent && !n.attrs.paragraphProperties?.styleId && s !== 'quote') {
          // retour au corps depuis une citation en mise en forme directe
          const { left, right, ...rest } = pp.indent;
          if (left === 851 && right === 567) pp.indent = Object.keys(rest).length ? rest : undefined;
        }
        if (s !== 'body' && pp.numberingProperties && s !== 'quote') delete pp.numberingProperties;
        tr = tr.setNodeMarkup(pos, undefined, { ...n.attrs, paragraphProperties: pp });
        return false;
      });
      if (tr.docChanged) ed.view.dispatch(tr);
      ed.view.focus();
    },
    toggleMark(m) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (m === 'bold') ed.commands.toggleBold();
      else if (m === 'italic') ed.commands.toggleItalic();
      else ed.commands.toggleUnderline();
      ed.view.focus();
    },
    toggleList(kind) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (kind === 'bullet') ed.commands.toggleBulletList();
      else ed.commands.toggleOrderedList();
      ed.view.focus();
    },
    insertFootnote() {
      touched = true;
      const ed = body();
      if (!ed) return false;
      caretIntoRun(ed);
      try {
        return !!ed.commands.insertFootnote();
      } catch (e) {
        console.error(e);
        return false;
      }
    },
    insertCitation(quote, note) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const S = ed.state.schema;
      const { state } = ed;
      const $from = state.selection.$from;
      const d = paraDepth($from);
      const styleId = resolveStyleId('quote');
      const quotePP: Any = styleId ? { styleId } : { indent: { left: 851, right: 567 } };
      const quotePara = S.nodes.paragraph.create({ paragraphProperties: quotePP }, S.nodes.run.create({}, S.text(quote)));
      const after = S.nodes.paragraph.create({ paragraphProperties: {} });
      let insertAt: number;
      let tr = state.tr;
      if (d > 0 && $from.node(d).content.size === 0) {
        // paragraphe vide : on le remplace
        const start = $from.before(d);
        tr = tr.replaceWith(start, $from.after(d), [quotePara, after]);
        insertAt = start;
      } else {
        insertAt = d > 0 ? $from.after(d) : state.doc.content.size;
        tr = tr.insert(insertAt, [quotePara, after]);
      }
      ed.view.dispatch(tr);
      // curseur à la fin du texte cité, dans le run
      let end = -1;
      ed.state.doc.nodesBetween(insertAt, insertAt + quotePara.nodeSize, (n: Any, p: number) => {
        if (n.isText) end = p + n.nodeSize;
        return true;
      });
      if (end < 0) return false;
      ed.commands.setTextSelection({ from: end, to: end });
      let ok = true;
      try {
        const res = ed.doc.footnotes.insert({ type: 'footnote', content: note });
        ok = !!res?.success;
      } catch (e) {
        console.error(e);
        ok = false;
      }
      // curseur dans le paragraphe vide qui suit, pour continuer à écrire
      const $q = ed.state.doc.resolve(Math.min(ed.state.doc.content.size, end));
      const qd = paraDepth($q);
      if (qd > 0) {
        const next = $q.after(qd) + 1;
        if (next <= ed.state.doc.content.size) ed.commands.setTextSelection({ from: next, to: next });
      }
      ed.view.focus();
      return ok;
    },
    appendParagraph(text) {
      touched = true;
      const ed = body();
      if (!ed) return;
      const S = ed.state.schema;
      const p = S.nodes.paragraph.create({ paragraphProperties: {} }, text ? S.nodes.run.create({}, S.text(text)) : null);
      ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, p));
    },
    undo() {
      touched = true;
      body()?.commands.undo();
    },
    redo() {
      touched = true;
      body()?.commands.redo();
    },
    goTo(pos) {
      const ed = body();
      if (!ed) return;
      const inside = Math.min(pos + 2, ed.state.doc.content.size);
      try {
        ed.commands.setTextSelection({ from: inside, to: inside });
      } catch {
        /* position hors texte */
      }
      const pe = pres();
      if (pe?.scrollToPositionAsync) pe.scrollToPositionAsync(inside, { block: 'start', behavior: 'smooth' });
      else if (pe?.scrollToPosition) pe.scrollToPosition(inside, { block: 'start', behavior: 'smooth' });
      ed.view.focus();
    },
    setEditable(on) {
      try {
        sd.setDocumentMode(on ? 'editing' : 'viewing');
      } catch (e) {
        console.warn(e);
      }
    },
    focus() {
      body()?.view?.focus();
    },
    destroy() {
      destroyed = true;
      for (const ev of INPUT_EVENTS) document.removeEventListener(ev, onUserInput, true);
      try {
        sd.destroy();
      } catch (e) {
        console.warn(e);
      }
    },
  };
  return engine;
}
