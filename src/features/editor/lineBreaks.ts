// ─────────────────────────────────────────────────────────────
// Retour arrière et Suppr à côté d'un saut de ligne manuel (↵, Maj+Entrée), comme dans Word.
// Dans SuperDoc, le ↵ est seul dans son « run » (bloc de texte) : au début du bloc qui le suit, le Retour
// arrière de SuperDoc sautait ce bloc et effaçait la dernière lettre du texte d'avant (« jurer » → « jure »),
// le ↵ restait. Ici, le ↵ voisin du curseur est effacé, lui.
// Greffé en tête des modules de l'éditeur (avant le clavier de SuperDoc).
// ─────────────────────────────────────────────────────────────
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Saut de ligne manuel (pas un saut de page ni de colonne). */
function isLineBreak(n: Any): boolean {
  if (!n) return false;
  const name = n.type?.name;
  if (name === 'lineBreak') return !n.attrs?.lineBreakType || n.attrs.lineBreakType === 'textWrapping' || n.attrs.lineBreakType === 'line';
  if (name === 'hardBreak') {
    const t = String(n.attrs?.pageBreakType ?? n.attrs?.lineBreakType ?? n.attrs?.type ?? '');
    return t === 'textWrapping' || t === 'line';
  }
  return false;
}

/**
 * Le ↵ juste avant (dir -1) ou juste après (dir 1) la position, en traversant les bords de blocs de texte
 * vides de contenu entre les deux : sa plage [from, to), ou null.
 */
export function lineBreakNear(doc: Any, pos: number, dir: -1 | 1): { from: number; to: number } | null {
  let p = pos;
  for (let guard = 0; guard < 8; guard++) {
    const $p = doc.resolve(p);
    const n = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (n) {
      if (isLineBreak(n)) return dir < 0 ? { from: p - n.nodeSize, to: p } : { from: p, to: p + n.nodeSize };
      if (n.isText || n.isLeaf || n.isBlock) return null;
      // bloc de texte (run) voisin : on y entre par son bord
      p = dir < 0 ? p - 1 : p + 1;
      continue;
    }
    // bord d'un bloc de texte (run) : on en sort, sans quitter le paragraphe
    if ($p.depth === 0 || $p.parent.isTextblock || $p.parent.isBlock) return null;
    p = dir < 0 ? $p.before() : $p.after();
  }
  return null;
}

const done = new WeakSet<object>();

/** Installe le traitement sur un éditeur SuperDoc (idempotent). */
export function attachLineBreakKeys(ed: Any): boolean {
  if (!ed || done.has(ed) || typeof ed.registerPlugin !== 'function' || !ed.state?.plugins?.length) return false;
  const PluginCtor = ed.state.plugins[0].constructor;
  const plugin = new PluginCtor({
    props: {
      handleKeyDown(view: Any, e: KeyboardEvent) {
        if ((e.key !== 'Backspace' && e.key !== 'Delete') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || view.composing) return false;
        if (view.editable === false) return false;
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty) return false;
        const br = lineBreakNear(state.doc, sel.from, e.key === 'Backspace' ? -1 : 1);
        if (!br) return false;
        const tr = state.tr.delete(br.from, br.to);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
  // En tête : avant le clavier de SuperDoc, qui traiterait la touche autrement.
  ed.registerPlugin(plugin, (p: Any, list: Any[]) => [p, ...list]);
  done.add(ed);
  return true;
}

/**
 * Alignement (centrer…) d'une partie d'un paragraphe découpé de ↵ : seules les lignes sélectionnées (ou celle
 * du curseur) changent. Le ↵ qui précède la sélection et celui qui la suit deviennent des sauts de paragraphe
 * (comme une Entrée) ; l'alignement porte ensuite sur ce paragraphe-là. Sans ↵ autour : rien ne change.
 * Renvoie vrai si le document a été découpé.
 */
export function isolateSelectedLines(ed: Any): boolean {
  const view = ed?.view;
  if (!view) return false;
  const { state } = view;
  const { from, to } = state.selection;
  const paraOf = (pos: number) => {
    const $p = state.doc.resolve(pos);
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).isTextblock) return { node: $p.node(d), start: $p.start(d) };
    return null;
  };
  const breaks = (p: { node: Any; start: number }) => {
    const out: { from: number; to: number }[] = [];
    p.node.descendants((n: Any, pos: number) => {
      if (isLineBreak(n)) out.push({ from: p.start + pos, to: p.start + pos + n.nodeSize });
    });
    return out;
  };
  const targets: { from: number; to: number }[] = [];
  const pf = paraOf(from);
  const pt = paraOf(to);
  if (pf) {
    const before = breaks(pf).filter((b) => b.to <= from);
    if (before.length) targets.push(before[before.length - 1]);
  }
  if (pt) {
    const after = breaks(pt).filter((b) => b.from >= to);
    if (after.length) targets.push(after[0]);
  }
  if (!targets.length) return false;
  // La sélection est retrouvée par son rang dans le texte (lettres avant elle) : les découpages ne retirent
  // que des ↵, jamais de lettres.
  const rank = (doc: Any, pos: number) => {
    let n = 0;
    doc.nodesBetween(0, pos, (node: Any, at: number) => {
      if (node.isText) n += Math.max(0, Math.min(node.nodeSize, pos - at));
      return true;
    });
    return n;
  };
  const posOf = (doc: Any, r: number, end: boolean) => {
    let left = r;
    let found = -1;
    doc.descendants((node: Any, at: number) => {
      if (found >= 0) return false;
      if (!node.isText) return true;
      // début : dans le texte où commence la lettre ; fin : dans le texte où finit la précédente
      if (end ? left <= node.nodeSize && left > 0 : left < node.nodeSize) found = at + left;
      else left -= node.nodeSize;
      return false;
    });
    return found;
  };
  const rFrom = rank(state.doc, from);
  const rTo = rank(state.doc, to);
  // De la fin vers le début : une coupure ne déplace pas celles d'avant.
  for (const b of targets.sort((x, y) => y.from - x.from)) {
    ed.commands.setTextSelection({ from: b.from, to: b.to });
    ed.commands.deleteSelection();
    if (!(ed.commands.splitRunToParagraph?.() ?? false)) ed.commands.splitBlock();
  }
  const doc = ed.view.state.doc;
  const a = posOf(doc, rFrom, false);
  const z = from === to ? a : posOf(doc, rTo, true);
  if (a < 0 || z < 0) return true;
  ed.commands.setTextSelection({ from: a, to: z });
  return true;
}
