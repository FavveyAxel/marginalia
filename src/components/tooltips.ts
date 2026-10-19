// Infobulles de l'app, en HTML, à la place des infobulles natives (attribut `title`).
// Aucun composant à changer : on garde `title="…"` dans le JSX. Au survol (ou au focus clavier),
// l'attribut est retiré le temps de l'affichage (le navigateur n'affiche donc pas la sienne), le texte
// passe dans une bulle stylée, puis l'attribut est remis à la sortie. Si React change le titre pendant
// le survol, la bulle suit.
import './tooltips.css';

const DELAY = 450; // avant la première bulle
const WARM = 400; // juste après une bulle, la suivante s'affiche tout de suite
const GAP = 8;

let tip: HTMLDivElement | null = null;
let cur: HTMLElement | null = null;
let text = '';
let timer = 0;
let watch = 0;
let lastHide = 0;
let obs: MutationObserver | null = null;
let addedLabel = false;
let addedDesc = false;

function bubble(): HTMLDivElement {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.id = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  return tip;
}

/** Retire le `title` de l'élément (gardé en mémoire) pour bloquer l'infobulle native. */
function take(el: HTMLElement) {
  const t = el.getAttribute('title');
  if (t == null) return;
  el.removeAttribute('title');
  if (t.trim()) {
    text = t;
    el.dataset.tipTitle = t;
  }
  if (tip && cur === el) {
    tip.textContent = text;
    if (tip.classList.contains('on')) place(el);
  }
}

function release() {
  const el = cur;
  obs?.disconnect();
  obs = null;
  clearTimeout(timer);
  clearInterval(watch);
  if (tip?.classList.contains('on')) lastHide = Date.now();
  tip?.classList.remove('on');
  if (!el) return;
  const t = el.dataset.tipTitle;
  if (t != null && !el.hasAttribute('title')) el.setAttribute('title', t);
  delete el.dataset.tipTitle;
  if (addedLabel) el.removeAttribute('aria-label');
  if (addedDesc) el.removeAttribute('aria-describedby');
  addedLabel = addedDesc = false;
  cur = null;
}

function place(el: HTMLElement) {
  const b = bubble();
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = r.bottom + GAP;
  let side = 'below';
  if (top + h > vh - 6) {
    top = r.top - GAP - h;
    side = 'above';
  }
  const left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), vw - w - 6);
  b.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(6, top))}px)`;
  b.dataset.side = side;
}

function show() {
  const el = cur;
  if (!el || !el.isConnected || !text) return;
  // Inutile de répéter un libellé déjà affiché en entier (élément de menu, onglet avec son nom).
  if (el.innerText.replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim()) return;
  const b = bubble();
  b.textContent = text;
  // Nom accessible : l'infobulle native servait parfois de seul nom (boutons à icône).
  if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim()) {
    el.setAttribute('aria-label', text);
    addedLabel = true;
  } else if (!el.hasAttribute('aria-describedby') && el.getAttribute('aria-label') !== text) {
    el.setAttribute('aria-describedby', 'app-tip');
    addedDesc = true;
  }
  b.classList.remove('on');
  place(el);
  b.classList.add('on');
  // L'élément peut disparaître sans événement de sortie (menu fermé, vue changée).
  clearInterval(watch);
  watch = window.setInterval(() => {
    if (!cur || !cur.isConnected) release();
  }, 250);
}

function enter(el: HTMLElement, immediate: boolean) {
  if (el === cur) return;
  release();
  cur = el;
  text = '';
  take(el);
  if (!text) text = el.dataset.tip ?? '';
  obs = new MutationObserver(() => take(el));
  obs.observe(el, { attributes: true, attributeFilter: ['title'] });
  if (!text) return;
  clearTimeout(timer);
  if (immediate || Date.now() - lastHide < WARM) show();
  else timer = window.setTimeout(show, DELAY);
}

/** Élément porteur d'une infobulle au-dessus de `t` (le plus proche). */
function holder(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element)) return null;
  const el = t.closest<HTMLElement>('[title], [data-tip], [data-tip-title]');
  return el instanceof HTMLElement ? el : null;
}

export function installTooltips() {
  if ((window as { __tips?: boolean }).__tips) return;
  (window as { __tips?: boolean }).__tips = true;

  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType === 'touch') return;
      const el = holder(e.target);
      if (el) enter(el, false);
      else if (cur) release();
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!cur) return;
      const to = e.relatedTarget as Node | null;
      if (to && cur.contains(to) && holder(to) === cur) return;
      if (!to) release();
    },
    true,
  );
  document.addEventListener(
    'focusin',
    (e) => {
      const el = holder(e.target);
      if (el && el === e.target && el.matches(':focus-visible')) enter(el, true);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (e) => {
      if (cur && e.target === cur) release();
    },
    true,
  );
  // Un clic, un défilement ou Échap ferment la bulle ; elle ne revient qu'au prochain survol.
  const close = () => {
    if (!cur) return;
    clearTimeout(timer);
    clearInterval(watch);
    tip?.classList.remove('on');
  };
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('wheel', close, { capture: true, passive: true });
  document.addEventListener('scroll', close, true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && tip?.classList.contains('on')) close();
    },
    true,
  );
  window.addEventListener('blur', release);
}
