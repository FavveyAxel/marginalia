// ─────────────────────────────────────────────────────────────
// Export PDF « tel qu'à l'écran » : le document est remis en page par le moteur d'édition lui-même
// (même découpage en pages, mêmes sauts de page, notes en bas de page, numéros de page, en-têtes et
// pieds de page), dans une instance cachée et en lecture seule, puis ses pages sont imprimées telles
// quelles, une page de l'éditeur = une page du PDF.
//
// Le .docx reçu est la copie d'export (sans notes privées ni signets de citation) : l'instance cachée
// n'a ni sélection, ni curseur, ni soulignés d'orthographe, ni teinte de l'interface.
// ─────────────────────────────────────────────────────────────
import { loadSuperDoc } from './engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface PagePrintOptions {
  /** @font-face (data:) des polices fournies avec l'app, pour la fenêtre d'impression hors réseau. */
  fontCss?: string;
  /** Plafond d'attente de la mise en page (ms). */
  timeout?: number;
  /** 'web' : page web à lire à l'écran (pages centrées sur un fond gris, imprimables telles quelles). */
  mode?: 'print' | 'web';
  /** Titre de la page web. */
  title?: string;
}

export interface PagePrint {
  html: string;
  pages: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Page web : les pages du document les unes sous les autres, comme dans l'éditeur. */
const WEB_CSS = `
@media screen {
  html, body { background: #e9e5dc !important; }
  .mgl-print-pages { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 32px 12px 64px; }
  .mgl-print-pages > .superdoc-page { box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08) !important; flex: none; }
}
@media screen and (max-width: 860px) { .mgl-print-pages { zoom: 0.6; } }
@media screen and (max-width: 520px) { .mgl-print-pages { zoom: 0.42; } }
`;

/** Feuilles de style du document courant (celles de SuperDoc comprises), en texte. */
function collectCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // feuille d'une autre origine : illisible (et inutile ici)
    }
    for (const r of Array.from(rules)) {
      // @font-face de l'app : adresses app:// ou http:// inaccessibles à l'impression ; remplacées par fontCss
      if (r.type === CSSRule.FONT_FACE_RULE) continue;
      css += r.cssText + '\n';
    }
  }
  return css;
}

async function blobToDataUrl(url: string): Promise<string | null> {
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

/** Images (blob:, http:) des pages copiées → data: (la fenêtre d'impression n'y a pas accès). */
async function inlineImages(root: HTMLElement) {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (!src || src.startsWith('data:')) continue;
    const data = await blobToDataUrl(img.src);
    if (data) img.setAttribute('src', data);
    else img.remove();
  }
}

/** Nombre de pages stable pendant un moment (la mise en page progresse par étapes). */
async function waitStable(host: HTMLElement, timeout: number) {
  const t0 = performance.now();
  let last = -1;
  let since = performance.now();
  while (performance.now() - t0 < timeout) {
    const n = host.querySelectorAll('.superdoc-page').length;
    const h = host.querySelector('.presentation-editor__pages')?.getBoundingClientRect().height ?? 0;
    const sig = n * 1e6 + Math.round(h);
    if (sig !== last) {
      last = sig;
      since = performance.now();
    } else if (n > 0 && performance.now() - since > 700) return;
    await sleep(120);
  }
}

/**
 * Met en page `docx` avec le moteur d'édition (instance cachée) et renvoie un HTML imprimable dont
 * chaque page est une page de l'éditeur. Rejette si le moteur échoue (l'appelant revient alors à
 * l'export reconstruit).
 */
export async function renderPagesForPrint(docx: ArrayBuffer, opts: PagePrintOptions = {}): Promise<PagePrint> {
  const SuperDoc = await loadSuperDoc();
  const host = document.createElement('div');
  host.className = 'mgl-print-host';
  // hors écran mais mis en page (pas display:none, sinon rien n'est mesuré)
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-30000px', top: '0', width: '1400px', height: '1200px', overflow: 'hidden', pointerEvents: 'none', zIndex: '-1' });
  document.body.appendChild(host);
  let inst: Any = null;
  try {
    const file = new File([docx], 'document.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    inst = await new Promise<Any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mise en page trop longue')), opts.timeout ?? 45000);
      try {
        const sd: Any = new SuperDoc({
          selector: host,
          document: file,
          documentMode: 'viewing',
          telemetry: { enabled: false },
          proofing: { enabled: false },
          disablePiniaDevtools: true,
          disableContextMenu: true,
          rulers: false,
          modules: { comments: false },
          zoom: { mode: 'manual', initial: 100 },
          // toutes les pages dans le DOM (par défaut, seule une fenêtre de ~5 pages autour de la vue y est)
          layoutEngineOptions: { virtualization: { enabled: false } },
          onReady: () => {
            clearTimeout(timer);
            resolve(sd);
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
    });
    await document.fonts?.ready;
    await waitStable(host, opts.timeout ?? 45000);
    const pages = Array.from(host.querySelectorAll<HTMLElement>('.superdoc-page'));
    if (!pages.length) throw new Error('Aucune page mise en page');
    // Taille réelle d'une page (zoom 100 %), en pixels CSS : 96 px par pouce.
    const first = pages[0];
    const w = parseFloat(first.style.width) || first.offsetWidth;
    const h = parseFloat(first.style.height) || first.offsetHeight;
    // garde-fou : si des pages manquent au DOM (fenêtre virtuelle), l'export reconstruit prend le relais
    const total = host.querySelector('.presentation-editor__pages')?.scrollHeight ?? 0;
    if (total > (pages.length + 1) * h) throw new Error(`Pages manquantes (${pages.length} dans le DOM)`);
    const wrap = document.createElement('div');
    for (const p of pages) {
      const c = p.cloneNode(true) as HTMLElement;
      // interface de l'éditeur éventuelle (sélection, curseur, poignées) : jamais imprimée
      // (calques vides par construction : on ne retire jamais un élément porteur de texte)
      c.querySelectorAll('[class*="selection"], [class*="cursor"], [class*="caret"]').forEach((n) => {
        if (!n.textContent?.trim() && !n.querySelector('img')) n.remove();
      });
      wrap.appendChild(c);
    }
    await inlineImages(wrap);
    const css = collectCss();
    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">${opts.mode === 'web' ? `\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(opts.title ?? '')}</title>` : ''}
<style>
${css}
${opts.fontCss ?? ''}
@page { size: ${w}px ${h}px; margin: 0; }
html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.mgl-print-pages { display: block; }
.mgl-print-pages > .superdoc-page {
  position: relative !important; left: auto !important; top: auto !important; transform: none !important;
  margin: 0 !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
  background: #fff !important; overflow: hidden !important;
  width: ${w}px !important; height: ${h}px !important;
  break-after: page; page-break-after: always; break-inside: avoid;
}
.mgl-print-pages > .superdoc-page:last-child { break-after: auto; page-break-after: auto; }
${opts.mode === 'web' ? WEB_CSS : ''}
</style>
</head>
<body>
<div class="mgl-print-pages">${wrap.innerHTML}</div>
</body>
</html>
`;
    return { html, pages: pages.length };
  } finally {
    try {
      inst?.destroy?.();
    } catch {
      /* déjà détruit */
    }
    host.remove();
  }
}
