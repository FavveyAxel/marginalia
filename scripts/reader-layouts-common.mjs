// Commun aux scripts de revue des mises en page du lecteur :
//   scripts/shots-reader-layouts.mjs (captures + planche + galerie)
//   scripts/check-reader-layouts.mjs (vérifications automatiques)
// Combinaisons : readerLayout × bookLayout × paperLook (thème clair), plus sombre et sépia pour les
// 4 combinaisons « vitrines ». Les réglages absents de la version du code (avant fusion) sont tolérés :
// le lecteur garde alors son rendu par défaut et la combinaison est signalée « non implémentée ».
import path from 'node:path';
import { epubFrench, importBuffer, FRENCH_SPAN_MARK, FRENCH_NOTE_TEXT } from './fixtures-books.mjs';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
/** Dépôt principal, même quand le script tourne depuis une copie de travail (.claude/worktrees/…). */
export const MAIN_ROOT = ROOT.includes('/.claude/worktrees/') ? ROOT.slice(0, ROOT.indexOf('/.claude/worktrees/')) : ROOT;
export const OUT_DIR = process.env.REVUE_OUT ? path.resolve(process.env.REVUE_OUT) : path.join(MAIN_ROOT, 'shots/revue');

export const LAYOUTS = [
  { id: 'scroll', label: 'Défilement', readerLayout: 'scroll', pagedSpread: undefined },
  { id: 'sheets', label: 'Feuilles', readerLayout: 'sheets', pagedSpread: undefined },
  { id: 'paged1', label: 'Pages (simple)', readerLayout: 'paged', pagedSpread: 'single' },
  { id: 'paged2', label: 'Pages (double)', readerLayout: 'paged', pagedSpread: 'double' },
];
const THEME_LABEL = { light: 'clair', dark: 'sombre', sepia: 'sépia' };

/** Liste ordonnée des combinaisons à capturer / vérifier. */
export function combos() {
  const out = [];
  for (const L of LAYOUTS)
    for (const book of [false, true])
      for (const paper of [false, true]) out.push({ layout: L, bookLayout: book, paperLook: paper, theme: 'light' });
  // Vitrines : chaque mise en page avec mise en page livre + aspect papier, en sombre et en sépia.
  for (const theme of ['dark', 'sepia']) for (const L of LAYOUTS) out.push({ layout: L, bookLayout: true, paperLook: true, theme });
  return out.map((c, i) => {
    const slug = `${c.layout.id}-livre-${c.bookLayout ? 'on' : 'off'}-papier-${c.paperLook ? 'on' : 'off'}-${c.theme}`;
    const label = `${c.layout.label} · livre ${c.bookLayout ? 'oui' : 'non'} · papier ${c.paperLook ? 'oui' : 'non'} · ${THEME_LABEL[c.theme]}`;
    return { ...c, n: i + 1, slug, label };
  });
}

/** Le code sous test connaît-il les nouveaux réglages ? (data-layout sur la racine du lecteur) */
export const hasNewLayouts = (page) => page.evaluate(() => !!document.querySelector('.reader-page[data-pane="a"] [data-layout], .reader-page[data-pane="a"][data-layout]'));

export async function waitReader(page, pane = 'a') {
  await page.waitForFunction(
    (pane) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      return !!p && !!p.querySelector('.html-chapter-text') && !p.querySelector('.reader-loading') && !!p.querySelector('[data-testid=page-indicator]');
    },
    pane,
    { timeout: 25000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(300);
}

/**
 * Applique une combinaison par window.__store. `legacy` (code d'avant fusion, sans readerLayout) :
 * on approxime avec pageMarks (feuilles = « papier », sinon « trait et numéro »).
 */
export async function applyCombo(page, c, { legacy = false, panels = false } = {}) {
  const patch = {
    theme: c.theme,
    readerLayout: c.layout.readerLayout,
    pagedSpread: c.layout.pagedSpread,
    bookLayout: c.bookLayout,
    paperLook: c.paperLook,
    showToc: panels,
    showExtracts: panels,
  };
  if (legacy) patch.pageMarks = c.layout.id === 'sheets' ? undefined : 'numbered';
  await page.evaluate((patch) => window.__store.getState().updateSettings(patch), patch);
  await page.waitForTimeout(250);
  await waitReader(page);
  await page.waitForTimeout(500);
}

/** Ce que le DOM dit de la combinaison effectivement rendue. */
export const rootState = (page) =>
  page.evaluate(() => {
    const pane = document.querySelector('.reader-page[data-pane="a"]');
    const lay = pane?.matches('[data-layout]') ? pane : pane?.querySelector('[data-layout]');
    const has = (cls) => !!(pane?.classList.contains(cls) || pane?.querySelector('.' + cls));
    return {
      layout: lay?.dataset.layout ?? null,
      spread: lay?.dataset.spread ?? null,
      book: has('book-layout'),
      paper: has('paper-look'),
      theme: document.documentElement.dataset.theme,
      docClass: pane?.querySelector('.html-doc')?.className ?? '',
    };
  });

/** La combinaison demandée est-elle reconnue par le code (sinon : rendu par défaut) ? */
export function implemented(c, st) {
  const missing = [];
  if (st.layout !== c.layout.readerLayout) missing.push('readerLayout');
  if (c.bookLayout && !st.book) missing.push('bookLayout');
  if (c.paperLook && !st.paper) missing.push('paperLook');
  if (!c.bookLayout && st.book) missing.push('bookLayout (classe en trop)');
  if (!c.paperLook && st.paper) missing.push('paperLook (classe en trop)');
  return missing;
}

/**
 * Importe le livre français, l'ouvre, pose deux surlignages par le store :
 * « span » (Thèse) à cheval sur la coupure de la page 2 (milieu de paragraphe),
 * « note » (Argument, avec note du lecteur) dans la Méditation seconde.
 */
export async function setupBook(page) {
  const bookId = await importBuffer(page, 'meditations-metaphysiques.epub', await epubFrench());
  await waitReader(page);
  const ids = await page.evaluate(
    ({ bookId, mark, noteText }) => {
      const s = window.__store.getState();
      const pane = document.querySelector('.reader-page[data-pane="a"]');
      const anchorOf = (root, start, end) => {
        const t = root.textContent;
        return { kind: 'html', chapter: Number(root.dataset.chapter), start, end, prefix: t.slice(Math.max(0, start - 32), start), suffix: t.slice(end, end + 32) };
      };
      const el = [...pane.querySelectorAll('.pg-mark')].find((m) => m.dataset.pg === mark);
      const root = el.closest('.html-chapter-text');
      const r = document.createRange();
      r.setStart(root, 0);
      r.setEndBefore(el);
      const off = r.toString().length;
      const t = root.textContent;
      // Du début du mot ~90 signes avant la coupure à la fin du mot ~70 signes après.
      const start = t.lastIndexOf(' ', off - 90) + 1;
      const end = t.indexOf(' ', off + 70);
      const span = s.addHighlight({ bookId, category: 'these', text: t.slice(start, end), anchor: anchorOf(root, start, end), locationLabel: 'p. 1', printedPage: '1' });
      const root2 = [...pane.querySelectorAll('.html-chapter-text')].find((x) => x.textContent.includes(noteText));
      const s2 = root2.textContent.indexOf(noteText);
      const note = s.addHighlight({
        bookId,
        category: 'argument',
        text: noteText,
        anchor: anchorOf(root2, s2, s2 + noteText.length),
        locationLabel: 'p. 5',
        printedPage: '5',
        note: 'Le cogito : première certitude, obtenue par le doute lui-même.',
      });
      return { span: span.id, note: note.id };
    },
    { bookId, mark: FRENCH_SPAN_MARK, noteText: FRENCH_NOTE_TEXT },
  );
  await page.waitForFunction((id) => !!document.querySelector(`[data-hl-id="${id}"]`), ids.span, { timeout: 5000 });
  return { bookId, hl: ids };
}

/** Amène le surlignage à cheval à l'écran (chaque mise en page gère le saut à sa façon). */
export async function showSpan(page, hlId) {
  await page.evaluate((id) => window.__store.getState().jumpToHighlight(id), hlId);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__store.getState().setActiveHighlight(null));
  await page.waitForTimeout(200);
}

export async function tidy(page) {
  await page.mouse.move(2, 450);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
    getSelection()?.removeAllRanges();
  });
  await page.waitForTimeout(250);
}
