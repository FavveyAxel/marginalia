// « Reproduire la mise en forme » (pinceau) dans la VRAIE app Electron (build dist/), comme un
// utilisateur : écrit créé par Écrits › Nouveau › Vide, texte tapé au clavier, mise en forme posée par
// la barre d'outils (style « Titre 1 », police, taille, italique, gras, couleur, alignement), sélections
// à la souris (glisser, double-clic, clic), bouton pinceau, raccourcis envoyés comme de vraies touches
// (webContents.sendInputEvent : même chemin que le clavier, menus natifs compris), Échap, Ctrl+Z.
// Pas de window.__ed (absent en production) : on lit le résultat sur la page peinte (styles calculés
// des .superdoc-text-run) et dans le .docx exporté (boîte d'enregistrement simulée, document.xml).
//
// Scénarios (chaque cible doit RESSEMBLER à la source : styles calculés égaux) :
//   1. mot d'un « Titre 1 » → phrase du corps (bouton, un clic, sélection au glisser)
//   2. mot du corps Georgia 14 rouge italique → mot d'un titre (raccourcis copier / coller ;
//      Ctrl+Maj+C / V sous Linux = variante Windows, puis ⌥⌘C / ⌥⌘V avec ?platform=mac)
//   3. corps ordinaire → texte gras rouge (redevient ordinaire)
//   4. source mixte (la mise en forme du premier caractère l'emporte)
//   5. paragraphe « Titre 1 » centré entier → paragraphe du corps (mise en forme du paragraphe aussi)
//   6. cible = simple curseur (le mot sous le curseur)
//   7. double-clic : pinceau maintenu sur 3 sélections, puis Échap
//   8. enchaînement rapide : nouvelle copie / application juste après une application (pas de format
//      périmé, la copie d'un texte qu'on vient de peindre donne bien sa nouvelle mise en forme)
//   9. un seul Ctrl+Z annule
//  10. l'export Word reflète la mise en forme
//  D0-D5. écrit du modèle « Dissertation » : titres mis en forme par leur STYLE seul (pas de police /
//      taille directes), copie titre → texte, texte → titre, paragraphe entier, export.
//
// Lancer (après `npx vite build`) :
//   DISPLAY=:99 timeout 600 node scripts/test-electron-painter.mjs
//   APP_DIR=/chemin/vers/autre/worktree DISPLAY=:99 node scripts/test-electron-painter.mjs
// APP_DIR : dossier de l'app (package.json + electron/ + dist/) ; par défaut la racine de ce dépôt.
// SHOTS : dossier des captures d'échec (défaut /home/claude/marginalia/shots/pinceau-e2e).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.resolve(process.env.APP_DIR || ROOT);
const EXE = fs.existsSync(path.join(APP_DIR, 'node_modules/electron/dist/electron'))
  ? path.join(APP_DIR, 'node_modules/electron/dist/electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const SHOTS = process.env.SHOTS || '/home/claude/marginalia/shots/pinceau-e2e';
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-pinceau-'));
if (!fs.existsSync(path.join(APP_DIR, 'dist/index.html'))) {
  console.error(`dist/ absent dans ${APP_DIR} : lancer d'abord « npx vite build » dans ce dossier.`);
  process.exit(2);
}
console.log(`APP_DIR = ${APP_DIR}`);

// ── Résultats ──
const results = []; // { sc, name, ok, detail }
let current = '0';
const check = (name, ok, detail = '') => {
  results.push({ sc: current, name, ok: !!ok, detail });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} [${current}] ${name}${d ? ' — ' + d.slice(0, 900) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app;
let page;
async function scenario(id, title, fn) {
  current = id;
  console.log(`\n── Scénario ${id} : ${title}`);
  const before = results.length;
  try {
    await fn();
  } catch (e) {
    check('déroulement', false, String(e?.stack || e).slice(0, 600));
  }
  const failed = results.slice(before).some((r) => !r.ok);
  if (failed) {
    const f = path.join(SHOTS, `echec-${id}.png`);
    await page.screenshot({ path: f }).catch(() => {});
    console.log(`   capture : ${f}`);
  }
  // le pinceau ne doit pas rester armé d'un scénario à l'autre
  if (await painterOn().catch(() => false)) {
    await key('Escape');
    await sleep(150);
  }
}

// ── Lancement ──
async function launch() {
  const env = { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1' };
  delete env.MARGINALIA_APPLE_BOOKS;
  app = await electron.launch({ executablePath: EXE, args: ['--no-sandbox', APP_DIR], env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text().slice(0, 300));
  });
  await app.evaluate(({ dialog }) => {
    globalThis.__save = [];
    dialog.showSaveDialog = async () => {
      const q = globalThis.__save.shift();
      return q ?? { canceled: true };
    };
  });
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
}
const pageErrors = [];

// ── Touches natives (comme le clavier : page, puis raccourcis des menus natifs) ──
const MOD = { Control: 'control', Shift: 'shift', Alt: 'alt', Meta: 'meta' };
async function key(combo, wait = 350) {
  const parts = combo.split('+');
  const k = parts.pop();
  const modifiers = parts.map((p) => MOD[p]);
  await app.evaluate(({ BrowserWindow }, [k, modifiers]) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers });
    if (k.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers });
  }, [k, modifiers]);
  await sleep(wait);
}

// ── Lecture de la page peinte ──
const HELPERS = () => {
  if (window.__pt) return;
  /** Run peint visible : le correcteur garde l'original d'un run découpé, caché (data-sd-proofing="original"). */
  const visibleRun = (run) => !!run && run.dataset.sdProofing !== 'original' && getComputedStyle(run).display !== 'none';
  /** Lignes peintes : texte concaténé des .superdoc-text-run, et pour chaque caractère son nœud texte. */
  const lines = () =>
    [...document.querySelectorAll('.superdoc-page .superdoc-line')].map((line) => {
      let text = '';
      const map = [];
      const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!visibleRun(n.parentElement.closest('.superdoc-text-run'))) continue;
        for (let i = 0; i < n.data.length; i++) map.push({ node: n, off: i });
        text += n.data;
      }
      return { line, text, map };
    });
  const find = (needle, nth = 0) => {
    let k = 0;
    for (const l of lines()) {
      let i = l.text.indexOf(needle);
      while (i >= 0) {
        if (k++ === nth) return { ...l, i };
        i = l.text.indexOf(needle, i + 1);
      }
    }
    return null;
  };
  const FAM = (f) => f.split(',')[0].trim().replace(/^["']|["']$/g, '');
  window.__pt = {
    has: (needle) => !!find(needle),
    /** Styles calculés du caractère `i` du passage (run peint) + alignement du paragraphe. */
    style(needle, i = 0, nth = 0) {
      const f = find(needle, nth);
      if (!f) return null;
      const c = f.map[f.i + i];
      const run = c.node.parentElement.closest('.superdoc-text-run');
      const cs = getComputedStyle(c.node.parentElement);
      const frag = run.closest('.superdoc-fragment');
      return {
        fontFamily: FAM(cs.fontFamily),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        // soulignement ondulé du correcteur (spelling-error / grammar-error) : hors mise en forme
        textDecoration: cs.textDecorationLine.split(' ').filter((x) => !/-error$/.test(x)).join(' ') || 'none',
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        textTransform: cs.textTransform,
        fontVariantCaps: cs.fontVariantCaps,
        letterSpacing: cs.letterSpacing,
        verticalAlign: cs.verticalAlign,
        align: frag ? getComputedStyle(frag).textAlign : null,
        lineHeight: getComputedStyle(f.line).lineHeight,
      };
    },
    /** Rectangle (fenêtre) des caractères [a, b[ du passage. */
    rect(needle, a = 0, b = needle.length, nth = 0) {
      const f = find(needle, nth);
      if (!f) return null;
      const s = f.map[f.i + a];
      const e = f.map[f.i + b - 1];
      const r = document.createRange();
      r.setStart(s.node, s.off);
      r.setEnd(e.node, e.off + 1);
      const rs = [...r.getClientRects()].filter((x) => x.width > 0);
      if (!rs.length) return null;
      return { left: rs[0].left, top: rs[0].top, bottom: rs[0].bottom, right: rs[rs.length - 1].right, bottom2: rs[rs.length - 1].bottom, top2: rs[rs.length - 1].top };
    },
    /** Fait défiler la page pour que le passage soit visible (hors écran : la souris ne peut pas l'atteindre). */
    reveal(needle, nth = 0) {
      const f = find(needle, nth);
      if (!f) return false;
      const r = f.line.getBoundingClientRect();
      if (r.top >= 80 && r.bottom <= window.innerHeight - 80) return false;
      f.line.scrollIntoView({ block: 'center' });
      return true;
    },
    /** Rectangle de tout le paragraphe (fragment) contenant le passage. */
    fragRect(needle) {
      const f = find(needle);
      const fr = f?.line.closest('.superdoc-fragment');
      if (!fr) return null;
      const r = fr.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
    /** Texte du paragraphe dans le document (ProseMirror caché), pour le distinguer de la page peinte. */
    docParaText(needle) {
      const p = [...document.querySelectorAll('.ProseMirror p')].find((x) => x.textContent.includes(needle));
      return p ? p.textContent : null;
    },
    /** HTML du paragraphe dans le ProseMirror caché (marques, style) : diagnostic. */
    pmHtml(needle) {
      const p = [...document.querySelectorAll('.ProseMirror p, .ProseMirror h1, .ProseMirror h2')].find((x) => x.textContent.includes(needle));
      return p ? p.outerHTML.replace(/ data-[a-z-]+="[^"]*"/g, '').slice(0, 700) : null;
    },
    paraText(needle) {
      const f = find(needle);
      const fr = f?.line.closest('.superdoc-fragment');
      return fr ? [...fr.querySelectorAll('.superdoc-text-run')].filter(visibleRun).map((x) => x.textContent).join('') : null;
    },
  };
};
const pt = async (fn, ...args) => {
  await page.evaluate(HELPERS);
  return page.evaluate(([fn, args]) => window.__pt[fn](...args), [fn, args]);
};
const styleOf = (needle, i = 0, nth = 0) => pt('style', needle, i, nth);
const CHAR_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'color', 'backgroundColor', 'textTransform', 'fontVariantCaps', 'letterSpacing', 'verticalAlign'];
/** Différences (clés de caractères, + alignement/interligne si `para`) entre deux styles calculés. */
function diff(src, dst, para = false) {
  if (!src || !dst) return { manquant: { src: !!src, dst: !!dst } };
  const keys = para ? [...CHAR_KEYS, 'align', 'lineHeight'] : CHAR_KEYS;
  const d = {};
  for (const k of keys) if (src[k] !== dst[k]) d[k] = { attendu: src[k], obtenu: dst[k] };
  return d;
}
const same = (d) => Object.keys(d).length === 0;
const brief = (s) => (s ? `${s.fontFamily} ${s.fontSize} w${s.fontWeight} ${s.fontStyle} ${s.textDecoration} ${s.color} bg=${s.backgroundColor} align=${s.align}` : 'null');

// ── Souris ──
async function dragSelect(needle, a = 0, b = needle.length, nth = 0, wait = 450) {
  if (await pt('reveal', needle, nth)) await sleep(400);
  const r1 = await pt('rect', needle, a, a + 1, nth);
  const r2 = await pt('rect', needle, b - 1, b, nth);
  if (!r1 || !r2) throw new Error(`passage introuvable sur la page : « ${needle} »`);
  const y1 = (r1.top + r1.bottom) / 2;
  const y2 = (r2.top + r2.bottom) / 2;
  await page.mouse.move(r1.left + 0.6, y1);
  await page.mouse.down();
  await page.mouse.move((r1.left + r2.right) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(r2.right - 0.6, y2, { steps: 5 });
  await page.mouse.up();
  await sleep(wait);
}
async function dblclickWord(needle, nth = 0, wait = 400) {
  if (await pt('reveal', needle, nth)) await sleep(400);
  const r = await pt('rect', needle, 0, needle.length, nth);
  if (!r) throw new Error(`mot introuvable : « ${needle} »`);
  await page.mouse.dblclick((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  await sleep(wait);
}
async function caretIn(needle, i) {
  if (await pt('reveal', needle)) await sleep(400);
  const r = await pt('rect', needle, i, i + 1);
  if (!r) throw new Error(`mot introuvable : « ${needle} »`);
  await page.mouse.click(r.left + 0.5, (r.top + r.bottom) / 2);
  await sleep(350);
}

// ── Barre d'outils ──
const tb = (name) => page.locator(`.ed-toolbar [data-tb="${name}"]`).first();
const painterOn = () => tb('painter').evaluate((b) => b.getAttribute('aria-pressed') === 'true' || b.classList.contains('active'));
const painterSticky = () => tb('painter').evaluate((b) => b.classList.contains('sticky'));
async function setStyle(s) {
  await tb('style').click();
  await page.locator(`[data-style="${s}"]`).first().click();
  await sleep(500);
}
async function setFont(name) {
  await tb('font').click();
  const q = page.locator('.ed-font-search input');
  await q.waitFor({ timeout: 5000 });
  await q.fill(name);
  await sleep(300);
  await q.press('Enter');
  await sleep(500);
}
async function setSize(pt) {
  await tb('size').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(pt));
  await page.keyboard.press('Enter');
  await sleep(500);
}
async function setColor(hex) {
  await tb('color').click();
  await page.locator(`.ed-color-menu [data-color="${hex}"]`).first().click();
  await sleep(400);
}
async function setAlign(a) {
  await tb('align').click();
  await page.locator(`[data-align="${a}"]`).first().click();
  await sleep(400);
}
const styleLabel = () => tb('style').innerText();
const toastText = () => page.evaluate(() => document.querySelector('.toasts')?.textContent ?? '');

// ── .docx : propriétés effectives d'un mot (docDefaults → style de paragraphe (basedOn) → run) ──
async function docxModel(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const doc = await zip.file('word/document.xml').async('string');
  const styles = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  const styleXml = (id) => new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`).exec(styles)?.[0] ?? '';
  const rPrOf = (x) => /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(x)?.[1] ?? '';
  const onOff = (x, tag) => {
    const m = new RegExp(`<w:${tag}(?: w:val="([^"]*)")? ?/>`).exec(x);
    if (!m) return undefined;
    return !(m[1] === '0' || m[1] === 'false' || m[1] === 'off');
  };
  const props = (rpr) => {
    const o = {};
    const f = /<w:rFonts [^>]*w:ascii="([^"]+)"/.exec(rpr)?.[1];
    if (f) o.font = f;
    const sz = /<w:sz w:val="(\d+)"/.exec(rpr)?.[1];
    if (sz) o.sz = sz;
    for (const t of ['b', 'i', 'strike', 'caps', 'smallCaps']) {
      const v = onOff(rpr, t);
      if (v !== undefined) o[t] = v;
    }
    const u = /<w:u w:val="([^"]+)"/.exec(rpr)?.[1];
    if (u) o.u = u;
    const c = /<w:color w:val="([0-9A-Fa-f]{6}|auto)"/.exec(rpr)?.[1];
    if (c) o.color = c.toUpperCase();
    const hl = /<w:highlight w:val="([^"]+)"/.exec(rpr)?.[1] ?? /<w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(rpr)?.[1];
    if (hl) o.highlight = hl;
    const va = /<w:vertAlign w:val="([^"]+)"/.exec(rpr)?.[1];
    if (va) o.vertAlign = va;
    return o;
  };
  const styleChain = (id) => {
    const out = [];
    for (let i = 0; id && i < 10; i++) {
      const x = styleXml(id);
      if (!x) break;
      out.unshift(x);
      id = /<w:basedOn w:val="([^"]+)"/.exec(x)?.[1];
    }
    return out;
  };
  const defaults = props(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/.exec(styles)?.[1] ?? '');
  const base = { font: '', sz: '', b: false, i: false, strike: false, caps: false, smallCaps: false, u: 'none', color: 'AUTO', highlight: 'none', vertAlign: 'baseline', ...defaults };
  const defStyle = /<w:style [^>]*w:type="paragraph"[^>]*w:default="1"[^>]*w:styleId="([^"]+)"/.exec(styles)?.[1] ?? 'Normal';
  const paras = (doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => {
    const ppr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(p)?.[1] ?? '';
    const style = /<w:pStyle w:val="([^"]+)"/.exec(ppr)?.[1] ?? null;
    const chain = styleChain(style ?? defStyle);
    let jc = null;
    for (const sx of chain) jc = /<w:pPr>[\s\S]*?<w:jc w:val="([^"]+)"/.exec(sx)?.[1] ?? jc;
    jc = /<w:jc w:val="([^"]+)"/.exec(ppr)?.[1] ?? jc;
    const styleProps = Object.assign({}, ...chain.map((sx) => props(rPrOf(sx.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '')))));
    const runs = (p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []).map((r) => ({
      xml: r,
      text: (r.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
    }));
    return { style, jc, styleProps, runs, text: runs.map((r) => r.text).join('') };
  });
  const locate = (needle) => {
    for (const p of paras) {
      const i = p.text.indexOf(needle);
      if (i < 0) continue;
      let k = 0;
      for (const r of p.runs) {
        if (i < k + r.text.length) return { p, r };
        k += r.text.length;
      }
    }
    return null;
  };
  return {
    eff(needle) {
      const l = locate(needle);
      if (!l) return null;
      return { ...base, ...l.p.styleProps, ...props(rPrOf(l.r.xml)) };
    },
    runXml: (needle) => locate(needle)?.r.xml ?? '',
    paraText: (needle) => paras.find((p) => p.text.includes(needle))?.text ?? null,
    para(needle) {
      const l = locate(needle);
      return l ? { style: l.p.style, jc: l.p.jc } : null;
    },
  };
}

// Raccourcis du pinceau selon la plateforme simulée
let COPY = 'Control+Shift+C';
let PASTE = 'Control+Shift+V';
const UNDO = 'Control+Z';

const P = {
  h1: 'Le grand titre du chapitre',
  body: 'Premiere phrase du corps de texte ordinaire.',
  red: 'Ici un mot rouge en Georgia.',
  bold: 'Puis un passage gras et rouge ici.',
  mixed: 'Source Mixte vers la cible maintenant.',
  centered: 'Un titre centre',
  toTitle: 'Paragraphe ordinaire qui deviendra titre.',
  sticky: 'Cibles alpha beta gamma delta pour le pinceau.',
  caret: 'Le curseur sur ce mot suffit.',
  rapid: 'Rapide onze douze treize quatorze fin.',
  head2: 'Second titre avec motcle dedans',
  big: 'Titre agrandi en bleu',
  body2: 'Deuxieme phrase banale ensuite.',
};

try {
  await launch();
  console.log(await page.evaluate(() => `plateforme ${window.marginalia.platform}, ${innerWidth}×${innerHeight}, __ed ${typeof window.__ed}`));

  // ── Préparation : un écrit « Vide », texte tapé, mise en forme par la barre ──
  current = 'prep';
  await page.locator('.sidebar .nav-item', { hasText: 'Écrits' }).first().click();
  await sleep(600);
  await page.locator('button:has-text("Nouveau")').first().click();
  await page.locator('[data-template="vide"]').click();
  await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
  await sleep(1500);
  const pg = await page.locator('.superdoc-page').first().boundingBox();
  await page.mouse.click(pg.x + pg.width / 2, pg.y + 120);
  await sleep(300);
  const order = ['h1', 'body', 'red', 'bold', 'mixed', 'centered', 'toTitle', 'sticky', 'caret', 'rapid', 'head2', 'big', 'body2'];
  for (const [i, k] of order.entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(P[k], { delay: 2 });
  }
  await sleep(900);
  check('texte tapé visible sur la page', (await pt('has', P.caret)) && (await pt('has', P.h1)));

  // Titre 1 sur le 1er paragraphe, le 6e (centré) et le dernier
  await caretIn('grand', 2);
  await setStyle('h1');
  await caretIn('titre centre', 3);
  await setStyle('h1');
  await setAlign('center');
  await caretIn('motcle', 2);
  await setStyle('h1');
  // titre personnalisé par l'utilisateur : Titre 1, puis 20 pt et bleu encre sur tout le paragraphe
  await caretIn('agrandi', 2);
  await setStyle('h1');
  await dragSelect(P.big);
  await setSize(20);
  await dragSelect(P.big);
  await setColor('#1F4E9A');
  check('« Titre 1 » posé par le menu Style', /Titre 1/.test(await styleLabel()), await styleLabel());
  // « rouge » : Georgia 14, italique, rouge brique
  await dblclickWord('rouge');
  await setFont('Georgia');
  await dblclickWord('rouge');
  await setSize(14);
  await dblclickWord('rouge');
  await tb('italic').click();
  await sleep(300);
  await setColor('#B03A2E');
  // « passage gras » : gras + rouge
  await dragSelect('passage gras');
  await tb('bold').click();
  await sleep(300);
  await setColor('#B03A2E');
  // « Mixte » : « Mi » gras, « xte » italique
  await dragSelect('Mixte', 0, 2);
  await tb('bold').click();
  await sleep(300);
  // clic ailleurs d'abord : partir du bord de la sélection « Mi » la déplacerait (glisser-déposer du texte)
  await caretIn('suffit', 2);
  await dragSelect('Mixte', 2, 5);
  await tb('italic').click();
  await sleep(500);
  await caretIn('suffit', 2); // désélectionne
  {
    const shown = await pt('paraText', 'Source');
    const inDoc = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent).find((t) => t.includes('Source')) ?? null);
    check('préparation : « Mi » gras puis « xte » italique ne change pas l’ordre du texte', shown === P.mixed && (inDoc === null || inDoc === P.mixed), { page: shown, document: inDoc });
  }
  const red = await styleOf('rouge', 2);
  check('préparation : « rouge » Georgia 14 pt italique rouge', red && red.fontFamily === 'Georgia' && red.fontStyle === 'italic' && /176, 58, 46/.test(red.color), brief(red));
  const pg2 = await styleOf('passage gras', 2);
  check('préparation : « passage gras » gras rouge', pg2 && Number(pg2.fontWeight) >= 600 && /176, 58, 46/.test(pg2.color), brief(pg2));
  const h = await styleOf('grand', 1);
  const b = await styleOf('ordinaire', 1);
  check('préparation : le titre se distingue du corps', h && b && !same(diff(h, b)), { titre: brief(h), corps: brief(b) });
  await page.screenshot({ path: path.join(SHOTS, 'preparation.png') });

  // ── 1. Mot d'un titre → phrase du corps (bouton, un clic, glisser) ──
  await scenario('1', 'mot de « Titre 1 » → phrase du corps (bouton un clic + glisser)', async () => {
    await dblclickWord('grand');
    const src = await styleOf('grand', 1);
    await tb('painter').click();
    await sleep(300);
    check('bouton : pinceau armé après un clic', await painterOn());
    await dragSelect('Premiere phrase');
    const d1 = diff(src, await styleOf('Premiere phrase', 0));
    const d2 = diff(src, await styleOf('Premiere phrase', 12));
    check('« Premiere phrase » ressemble au mot du titre (1er caractère)', same(d1), d1);
    check('« Premiere phrase » ressemble au mot du titre (dernier caractère)', same(d2), d2);
    const nb = await styleOf('du corps', 1);
    check('le texte voisin (« du corps ») garde l’aspect du corps', same(diff(b, nb)), diff(b, nb));
    check('un clic : le pinceau se désarme après une application', !(await painterOn()));
    check('le paragraphe cible reste « Corps » (sélection partielle)', await (async () => {
      await caretIn('ordinaire', 3);
      return !/Titre/.test(await styleLabel());
    })(), await styleLabel());
  });

  // ── 1 bis. Mot d'un titre agrandi (20 pt, bleu) → phrase du corps ──
  await scenario('1b', 'mot d’un « Titre 1 » agrandi 20 pt bleu → phrase du corps (bouton + glisser)', async () => {
    await dblclickWord('agrandi');
    const src = await styleOf('agrandi', 2);
    check('source : 20 pt (26,67 px) bleu gras', src && src.fontSize === '26.6667px' && /31, 78, 154/.test(src.color), brief(src));
    await tb('painter').click();
    await sleep(300);
    await dragSelect('Deuxieme phrase');
    const d1 = diff(src, await styleOf('Deuxieme phrase', 0));
    const d2 = diff(src, await styleOf('Deuxieme phrase', 14));
    check('« Deuxieme phrase » ressemble au mot du titre agrandi', same(d1) && same(d2), { debut: d1, fin: d2 });
    const nb = diff(b, await styleOf('banale', 2));
    check('le texte voisin (« banale ») garde l’aspect du corps', same(nb), nb);
  });

  // ── 2. Corps Georgia 14 rouge italique → mot d'un titre, raccourcis (variante Windows / Linux) ──
  await scenario('2', `corps Georgia 14 rouge italique → mot d’un titre (${COPY} / ${PASTE})`, async () => {
    await dblclickWord('rouge');
    const src = await styleOf('rouge', 2);
    await key(COPY);
    check(`${COPY} : toast « Mise en forme copiée »`, /Mise en forme copiée/.test(await toastText()), await toastText());
    const after = await styleOf('rouge', 2);
    check(`${COPY} n’altère pas la source`, same(diff(src, after)), diff(src, after));
    await dragSelect('chapitre');
    await key(PASTE);
    const d = diff(src, await styleOf('chapitre', 3));
    check('« chapitre » (titre) ressemble à « rouge »', same(d), d);
    const nb = await styleOf('grand', 1);
    check('le reste du titre est inchangé', same(diff(h, nb)), diff(h, nb));
    const txt = await pt('paraText', 'chapitre');
    check(`${PASTE} n’a pas collé de texte (presse-papiers)`, txt === P.h1, txt);
  });

  // ── 3. Corps ordinaire → gras rouge (redevient ordinaire) ──
  await scenario('3', 'corps ordinaire → texte gras rouge (redevient ordinaire)', async () => {
    await dblclickWord('ordinaire');
    const src = await styleOf('ordinaire', 2);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('passage gras');
    const d = diff(src, await styleOf('passage gras', 3));
    check('« passage gras » redevient ordinaire (ni gras ni rouge)', same(d), d);
  });

  // ── 4. Source mixte : le premier caractère l'emporte ──
  await scenario('4', 'source mixte (« Mi » gras + « xte » italique) → le 1er caractère l’emporte', async () => {
    const first = await styleOf('Mixte', 0);
    const last = await styleOf('Mixte', 4);
    check('source bien mixte', !same(diff(first, last)), { premier: brief(first), dernier: brief(last) });
    await dragSelect('Mixte');
    await tb('painter').click();
    await sleep(300);
    await dragSelect('cible');
    const d0 = diff(first, await styleOf('cible', 0));
    const d4 = diff(first, await styleOf('cible', 4));
    check('« cible » prend la mise en forme du 1er caractère (gras, pas italique) — début', same(d0), d0);
    check('« cible » prend la mise en forme du 1er caractère — fin', same(d4), d4);
  });

  // ── 5. Paragraphe Titre 1 centré entier → paragraphe du corps ──
  await scenario('5', 'paragraphe « Titre 1 » centré entier → paragraphe du corps', async () => {
    const src = await styleOf('titre centre', 3);
    check('source : centrée', src?.align === 'center', brief(src));
    await dragSelect(P.centered);
    await tb('painter').click();
    await sleep(300);
    await dragSelect(P.toTitle);
    const dst = await styleOf('deviendra', 2);
    const d = diff(src, dst, true);
    check('le paragraphe cible ressemble au titre centré (caractères + alignement + interligne)', same(d), d);
    await caretIn('deviendra', 3);
    const lbl = await styleLabel();
    check('menu Style : le paragraphe cible est « Titre 1 »', /Titre 1/.test(lbl), lbl);
    const fr = await pt('fragRect', 'deviendra');
    const fs0 = await pt('fragRect', 'titre centre');
    check('même hauteur de paragraphe que la source', fr && fs0 && Math.abs(fr.bottom - fr.top - (fs0.bottom - fs0.top)) < 1.5, { source: fs0 && fs0.bottom - fs0.top, cible: fr && fr.bottom - fr.top });
  });

  // ── 6. Cible = curseur seul ──
  await scenario('6', 'cible = curseur seul (le mot sous le curseur)', async () => {
    await dblclickWord('rouge');
    const src = await styleOf('rouge', 2);
    await key(COPY);
    await caretIn('curseur', 3);
    const before = await styleOf('Le curseur', 0);
    await key(PASTE);
    const d = diff(src, await styleOf('curseur', 2));
    check('« curseur » (mot sous le curseur) ressemble à « rouge »', same(d), d);
    const d0 = diff(src, await styleOf('curseur', 0));
    const d6 = diff(src, await styleOf('curseur', 6));
    check('tout le mot, de la 1re à la dernière lettre', same(d0) && same(d6), { d0, d6 });
    const nbL = diff(before, await styleOf('Le curseur', 0));
    const nbS = diff(before, await styleOf('sur ce', 0));
    check('les mots voisins (« Le », « sur ») sont inchangés', same(nbL) && same(nbS), { nbL, nbS });
  });

  // ── 7. Double-clic : maintenu sur 3 sélections, puis Échap ──
  await scenario('7', 'double-clic : pinceau maintenu sur 3 sélections, puis Échap', async () => {
    await dblclickWord('rouge');
    const src = await styleOf('rouge', 2);
    const deltaBefore = await styleOf('delta', 2);
    await tb('painter').dblclick();
    await sleep(350);
    check('double-clic : pinceau maintenu (classe sticky)', (await painterOn()) && (await painterSticky()));
    for (const w of ['alpha', 'beta', 'gamma']) {
      await dragSelect(w);
      const d = diff(src, await styleOf(w, 1));
      check(`« ${w} » ressemble à « rouge »`, same(d), d);
    }
    check('pinceau toujours armé après 3 sélections', await painterOn());
    await key('Escape');
    check('Échap : pinceau désarmé', !(await painterOn()));
    await dragSelect('delta');
    const dd = diff(deltaBefore, await styleOf('delta', 2));
    check('après Échap : « delta » ne reçoit plus rien', same(dd), dd);
  });

  // ── 8. Enchaînement rapide : copie / application juste après une application ──
  await scenario('8', 'enchaînement rapide : nouvelle copie / application juste après une application', async () => {
    const FAST = 120; // un utilisateur rapide : ~100-200 ms entre deux gestes
    const steps = [];
    const snap = async (label) => steps.push(`${label}: ${await pt('paraText', 'Rapide')}`);
    await dblclickWord('rouge');
    const A = await styleOf('rouge', 2);
    const B = await styleOf('grand', 1);
    check('sources différentes (« rouge » / « grand »)', !same(diff(A, B)), { A: brief(A), B: brief(B) });
    // a) bouton : « onze » ← « rouge », puis AUSSITÔT copie de « grand » au raccourci → « douze »
    await tb('painter').click();
    await sleep(FAST);
    await dragSelect('onze', 0, 4, 0, FAST);
    await dblclickWord('grand', 0, FAST);
    await key(COPY, FAST);
    await dragSelect('douze', 0, 5, 0, FAST);
    await key(PASTE, FAST);
    await snap('a');
    // b) AUSSITÔT : copie de « douze » qu'on vient de peindre → « treize »
    await dblclickWord('douze', 0, FAST);
    await key(COPY, FAST);
    await dragSelect('treize', 0, 6, 0, FAST);
    await key(PASTE, FAST);
    await snap('b');
    // c) AUSSITÔT : « onze » (peint en a) au bouton → « quatorze »
    await dblclickWord('onze', 0, FAST);
    await tb('painter').click();
    await sleep(FAST);
    await dragSelect('quatorze', 0, 8, 0, FAST);
    await snap('c');
    await sleep(800); // laisser la page se repeindre avant de lire
    const da = diff(A, await styleOf('onze', 1));
    check('a) « onze » ressemble à « rouge » (bouton)', same(da), da);
    const db = diff(B, await styleOf('douze', 1));
    check('a) « douze » ressemble à « grand » (nouvelle copie, pas l’ancienne)', same(db), { ...db, cible: brief(await styleOf('douze', 1)) });
    const dc = diff(B, await styleOf('treize', 1));
    check('b) « treize » ressemble à « douze » fraîchement peint (= « grand »)', same(dc), { ...dc, cible: brief(await styleOf('treize', 1)) });
    const dd = diff(A, await styleOf('quatorze', 1));
    check('c) « quatorze » ressemble à « onze » fraîchement peint (= « rouge »)', same(dd), { ...dd, cible: brief(await styleOf('quatorze', 1)) });
    const txt = await pt('paraText', 'Rapide');
    const inDoc = await pt('docParaText', 'Rapide');
    check('texte du paragraphe intact (page peinte et document)', txt === P.rapid && (inDoc === null || inDoc === P.rapid), { page: txt, document: inDoc, etapes: steps });
    check('pinceau désarmé à la fin (un clic = une application)', !(await painterOn()));
  });

  // ── 9. Un seul Ctrl+Z annule ──
  await scenario('9', 'un seul Ctrl+Z annule l’application', async () => {
    const before = await styleOf('pinceau', 2);
    await dblclickWord('rouge');
    const src = await styleOf('rouge', 2);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('pinceau');
    const applied = diff(src, await styleOf('pinceau', 2));
    check('application faite avant l’annulation', same(applied), applied);
    await key(UNDO);
    await sleep(300);
    const d = diff(before, await styleOf('pinceau', 2));
    check('un seul Ctrl+Z : « pinceau » retrouve son aspect d’avant', same(d), d);
    const txt = await pt('paraText', 'pinceau');
    check('Ctrl+Z n’a pas défait autre chose (texte intact)', txt === P.sticky, txt);
    const g = diff(src, await styleOf('gamma', 1));
    check('les applications précédentes (« gamma ») sont conservées', same(g), g);
  });

  // ── 2 bis. Raccourcis Mac (⌥⌘C / ⌥⌘V) avec ?platform=mac ──
  await scenario('2mac', 'raccourcis Mac ⌥⌘C / ⌥⌘V (app rechargée en ?platform=mac)', async () => {
    const url = await page.evaluate(() => location.href);
    // enregistrer avant de recharger
    await key('Control+S');
    await sleep(800);
    const u = new URL(url);
    u.searchParams.set('platform', 'mac');
    await page.goto(u.toString());
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await page.locator('.sidebar .nav-item', { hasText: 'Écrits' }).first().click();
    await sleep(600);
    await page.locator('[data-draft]').first().click();
    await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
    await sleep(1500);
    const title = await tb('painter').getAttribute('title');
    check('infobulle en notation Mac (⌥⌘C / ⌥⌘V)', /⌥⌘C/.test(title ?? '') && /⌥⌘V/.test(title ?? ''), title);
    COPY = 'Meta+Alt+C';
    PASTE = 'Meta+Alt+V';
    await dblclickWord('rouge');
    const src = await styleOf('rouge', 2);
    await key(COPY);
    check('⌥⌘C : toast « Mise en forme copiée »', /Mise en forme copiée/.test(await toastText()), await toastText());
    await dragSelect('motcle');
    await key(PASTE);
    const d = diff(src, await styleOf('motcle', 2));
    check('« motcle » (titre) ressemble à « rouge » après ⌥⌘V', same(d), d);
    const txt = await pt('paraText', 'motcle');
    check('⌥⌘V n’a pas modifié le texte', txt === P.head2, txt);
  });

  // ── 10. Export Word ──
  await scenario('10', 'l’export Word reflète la mise en forme', async () => {
    const out = path.join(TMP, 'pinceau.docx');
    await app.evaluate((_e, f) => globalThis.__save.push({ canceled: false, filePath: f }), out);
    await page.locator('[data-tb="export"]').first().click();
    await page.locator('[data-fmt="docx"]').first().click();
    const t0 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t0 < 30000) await sleep(200);
    await sleep(800);
    check('fichier .docx écrit', fs.existsSync(out));
    if (!fs.existsSync(out)) return;
    fs.copyFileSync(out, path.join(SHOTS, 'pinceau-export.docx'));
    const x = await docxModel(out);
    // Propriétés EFFECTIVES (docDefaults + style du paragraphe + run) : la cible doit égaler la source
    const pairs = [
      ['1', 'grand', 'Premiere'],
      ['1b', 'agrandi', 'Deuxieme'],
      ['2', 'rouge', 'chapitre'],
      ['3', 'ordinaire', 'passage'],
      ['4', 'Mixte', 'cible'],
      ['5', 'centre', 'deviendra'],
      ['6', 'rouge', 'curseur'],
      ['7', 'rouge', 'alpha'],
      ['7', 'rouge', 'beta'],
      ['7', 'rouge', 'gamma'],
      ['8', 'rouge', 'onze'],
      ['8', 'grand', 'douze'],
      ['8', 'grand', 'treize'],
      ['8', 'rouge', 'quatorze'],
      ['2mac', 'rouge', 'motcle'],
    ];
    for (const [sc, a, b] of pairs) {
      const ea = x.eff(a);
      const eb = x.eff(b);
      const d = {};
      if (!ea || !eb) d.manquant = { [a]: !!ea, [b]: !!eb };
      else for (const k of Object.keys(ea)) if (ea[k] !== eb[k]) d[k] = { attendu: ea[k], obtenu: eb[k] };
      check(`export (sc. ${sc}) : « ${b} » a les propriétés effectives de « ${a} »`, same(d), Object.keys(d).length ? { ...d, runCible: x.runXml(b).slice(0, 300) } : '');
    }
    check('export (sc. 8) : texte du paragraphe « Rapide » intact', x.paraText('Rapide') === P.rapid, x.paraText('Rapide'));
    const pa = x.para('centre');
    const pb = x.para('deviendra');
    check('export (sc. 5) : paragraphe peint = style et alignement du titre centré', pa && pb && pa.style === pb.style && pa.jc === pb.jc && pb.jc === 'center', { source: pa, cible: pb });
    const p1 = x.para('Premiere');
    check('export (sc. 1) : le paragraphe cible reste du corps (sélection partielle)', p1 && p1.style !== x.para('grand')?.style, p1);
    for (const [sc, w] of [['7', 'delta'], ['9', 'pinceau']]) {
      const e = x.eff(w);
      const ref = x.eff('Cibles');
      const d = {};
      for (const k of Object.keys(ref ?? {})) if (ref[k] !== e?.[k]) d[k] = { attendu: ref[k], obtenu: e?.[k] };
      check(`export (sc. ${sc}) : « ${w} » non peint (comme « Cibles »)`, same(d), d);
    }
  });

  // ══ Écrit créé depuis le modèle « Dissertation » : titres mis en forme par leur STYLE seul ══
  // (dans « Vide », le texte tapé porte police et taille en direct ; ici, « Introduction » n'a que le style)
  await scenario('D0', 'préparation : écrit « Dissertation », texte du corps tapé', async () => {
    await page.locator('.sidebar .nav-item', { hasText: 'Écrits' }).first().click();
    await sleep(800);
    await page.locator('button:has-text("Nouveau")').first().click();
    await page.locator('[data-template="dissertation"]').click();
    await sleep(1500);
    await page.waitForFunction(() => [...document.querySelectorAll('.superdoc-page .superdoc-text-run')].some((r) => r.textContent.includes('Introduction')), null, { timeout: 60000 });
    await sleep(800);
    // fin du 1er « 1. Premier argument » (Titre 2), Entrée, phrase du corps
    const r = await pt('rect', 'Premier argument', 15, 16);
    await page.mouse.click(r.right + 2, (r.top + r.bottom) / 2);
    await sleep(300);
    await key('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Texte courant sous le premier argument, simple et sobre.', { delay: 2 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Une autre phrase qui deviendra un titre.', { delay: 2 });
    await sleep(800);
    check('texte tapé sous « Premier argument »', await pt('has', 'Texte courant'), await pt('paraText', 'Texte courant'));
    await caretIn('courant', 2);
    // (Entrée après un titre garde ici le style du titre : on remet « Corps » par le menu Style)
    console.log(`   style du paragraphe tapé après Entrée sur un Titre 2 : ${await styleLabel()}`);
    console.log('   PM avant « Corps » :', await pt('pmHtml', 'Texte courant'));
    await setStyle('body');
    console.log('   PM après « Corps » :', await pt('pmHtml', 'Texte courant'));
    console.log('   page après « Corps » :', brief(await styleOf('courant', 2)));
    // (l'attribut DOM « styleid » du ProseMirror caché n'est jamais retiré par SuperDoc : seul le .docx fait foi, cf. D5)
    const bodyLook = await styleOf('courant', 2);
    check('« Corps » après Entrée sur un Titre 2 : aspect du corps (12 pt, non gras), pas celui du titre', bodyLook && bodyLook.fontSize === '16px' && Number(bodyLook.fontWeight) < 600, brief(bodyLook));
    await caretIn('autre phrase', 2);
    await setStyle('body');
    await caretIn('courant', 2);
    check('le paragraphe tapé est du corps', !/Titre/.test(await styleLabel()), await styleLabel());
    const hI = await styleOf('Introduction', 2);
    const bT = await styleOf('courant', 2);
    check('« Introduction » (Titre 1) se distingue du corps', !same(diff(hI, bT)), { titre: brief(hI), corps: brief(bT) });
    await page.screenshot({ path: path.join(SHOTS, 'dissertation-preparation.png') });
  });

  await scenario('D1', 'Dissertation : mot du Titre 1 « Introduction » → phrase du corps (bouton + glisser)', async () => {
    const restBefore = await styleOf('premier argument,', 3);
    const USER_SHOTS = '/home/claude/marginalia/shots/pinceau';
    fs.mkdirSync(USER_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(USER_SHOTS, 'dissertation-avant.png') });
    await dblclickWord('Introduction');
    const src = await styleOf('Introduction', 2);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('Texte courant');
    await caretIn('simple', 2);
    await page.screenshot({ path: path.join(USER_SHOTS, 'dissertation-apres.png') });
    const d1 = diff(src, await styleOf('Texte courant', 0));
    const d2 = diff(src, await styleOf('Texte courant', 12));
    check('« Texte courant » ressemble à « Introduction »', same(d1) && same(d2), { debut: d1, fin: d2, source: brief(src), cible: brief(await styleOf('Texte courant', 0)) });
    // (la hauteur de LIGNE peut grandir : « Texte courant », plus grand, est sur la même ligne — comme Word)
    const dRest = diff(restBefore, await styleOf('premier argument,', 3), true);
    delete dRest.lineHeight;
    check('sélection partielle : le reste du paragraphe cible (« premier argument, ») est inchangé (caractères, alignement)', same(dRest), dRest);
    await caretIn('premier argument', 3);
    check('sélection partielle : le paragraphe cible reste « Corps »', !/Titre/.test(await styleLabel()), await styleLabel());
    console.log('   document (ProseMirror) de la cible :', await pt('pmHtml', 'Texte courant'));
  });

  await scenario('D1b', 'Dissertation : double-clic sur « Introduction » (mot = tout le paragraphe) → paragraphe entier du corps : caractères seuls', async () => {
    const before = await styleOf('Une autre', 2);
    await dblclickWord('Introduction');
    const src = await styleOf('Introduction', 2);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('Une autre phrase qui deviendra un titre.');
    const dst = await styleOf('Une autre', 2);
    check('les mots ressemblent à « Introduction »', same(diff(src, dst)), diff(src, dst));
    const html = (await pt('pmHtml', 'Une autre')) ?? '';
    check('paragraphe inchangé : interligne et alignement du corps (1,5, justifié), pas ceux du Titre 1', /line-height: 1\.5;/.test(html) && /text-align: justify/.test(html) && dst?.align === before?.align, html.slice(0, 160));
    await caretIn('Une autre', 3);
    check('menu Style : toujours « Corps » (double-clic : pas de copie du paragraphe)', !/Titre/.test(await styleLabel()), await styleLabel());
  });

  await scenario('D2', `Dissertation : mot du Titre 2 « argument » → mot du corps (${COPY} / ${PASTE})`, async () => {
    COPY = 'Control+Shift+C';
    PASTE = 'Control+Shift+V';
    if ((await page.evaluate(() => location.search)).includes('platform=mac')) {
      COPY = 'Meta+Alt+C';
      PASTE = 'Meta+Alt+V';
    }
    const tcBefore = await styleOf('Texte courant', 2);
    const restBefore = await styleOf('premier argument,', 3);
    await dblclickWord('argument');
    const src = await styleOf('argument', 2);
    await key(COPY);
    await dragSelect('sobre');
    await key(PASTE);
    const d = diff(src, await styleOf('sobre', 2));
    check('« sobre » ressemble à « argument » (Titre 2)', same(d), { ...d, source: brief(src), cible: brief(await styleOf('sobre', 2)) });
    const dTc = diff(tcBefore, await styleOf('Texte courant', 2), true);
    const dRest = diff(restBefore, await styleOf('premier argument,', 3), true);
    check('le reste du paragraphe cible est inchangé (« Texte courant » peint en D1, « premier argument, »)', same(dTc) && same(dRest), { texteCourant: dTc, reste: dRest });
  });

  await scenario('D3', 'Dissertation : mot du corps → mot du Titre 1 « Conclusion » (bouton + glisser)', async () => {
    await dblclickWord('simple');
    const src = await styleOf('simple', 2);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('Conclusion');
    const d = diff(src, await styleOf('Conclusion', 3));
    check('« Conclusion » ressemble au mot du corps', same(d), { ...d, source: brief(src), cible: brief(await styleOf('Conclusion', 3)) });
    console.log('   document (ProseMirror) de la source :', await pt('pmHtml', 'simple'));
    console.log('   document (ProseMirror) de la cible  :', await pt('pmHtml', 'Conclusion'));
  });

  await scenario('D4', 'Dissertation : curseur dans le Titre 1 « Introduction » → paragraphe du corps (paragraphe copié)', async () => {
    await caretIn('Introduction', 4);
    const src = await styleOf('Introduction', 4);
    await tb('painter').click();
    await sleep(300);
    await dragSelect('Une autre phrase qui deviendra un titre.');
    const d = diff(src, await styleOf('Une autre', 2), true);
    check('le paragraphe ressemble au Titre 1 (caractères, alignement, interligne)', same(d), { ...d, source: brief(src), cible: brief(await styleOf('Une autre', 2)) });
    await caretIn('Une autre', 3);
    check('menu Style : « Titre 1 »', /Titre 1/.test(await styleLabel()), await styleLabel());
    const hs = await pt('fragRect', 'Introduction');
    const ht = await pt('fragRect', 'Une autre');
    check('même hauteur de paragraphe que « Introduction »', hs && ht && Math.abs(hs.bottom - hs.top - (ht.bottom - ht.top)) < 1.5, { source: hs && hs.bottom - hs.top, cible: ht && ht.bottom - ht.top });
  });

  await scenario('D5', 'Dissertation : export Word', async () => {
    const out = path.join(TMP, 'dissertation.docx');
    await app.evaluate((_e, f) => globalThis.__save.push({ canceled: false, filePath: f }), out);
    await page.locator('[data-tb="export"]').first().click();
    await page.locator('[data-fmt="docx"]').first().click();
    const t0 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t0 < 30000) await sleep(200);
    await sleep(800);
    check('fichier .docx écrit', fs.existsSync(out));
    if (!fs.existsSync(out)) return;
    fs.copyFileSync(out, path.join(SHOTS, 'dissertation-export.docx'));
    const x = await docxModel(out);
    for (const [sc, a, b] of [['D1', 'Introduction', 'Texte courant'], ['D2', 'argument', 'sobre'], ['D3', 'simple', 'Conclusion'], ['D4', 'Introduction', 'Une autre']]) {
      const ea = x.eff(a);
      const eb = x.eff(b);
      const d = {};
      if (!ea || !eb) d.manquant = { [a]: !!ea, [b]: !!eb };
      else for (const k of Object.keys(ea)) if (ea[k] !== eb[k]) d[k] = { attendu: ea[k], obtenu: eb[k] };
      check(`export (sc. ${sc}) : « ${b} » a les propriétés effectives de « ${a} »`, same(d), Object.keys(d).length ? { ...d, runCible: x.runXml(b).slice(0, 300) } : '');
    }
    const pa = x.para('Introduction');
    const pb = x.para('Une autre');
    check('export (sc. D4) : paragraphe peint en style de « Introduction »', pa && pb && pa.style === pb.style, { source: pa, cible: pb });
    const pc = x.para('Texte courant');
    check('export (sc. D0/D1) : le paragraphe « Texte courant » est du corps (pas Heading2)', pc && !/Heading/i.test(String(pc.style ?? '')), pc);
  });

  current = 'fin';
  check('aucune erreur de page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 800));
} catch (e) {
  check('déroulement général', false, String(e?.stack || e).slice(0, 800));
  await page?.screenshot({ path: path.join(SHOTS, 'echec-general.png') }).catch(() => {});
} finally {
  await app?.close().catch(() => {});
}

// ── Tableau ──
console.log('\n══ Résultats par scénario ══');
const ids = [...new Set(results.map((r) => r.sc))];
for (const id of ids) {
  const rs = results.filter((r) => r.sc === id);
  const ko = rs.filter((r) => !r.ok);
  console.log(`${ko.length ? 'ÉCHEC' : 'OK   '}  ${id.padEnd(5)} ${rs.length - ko.length}/${rs.length}${ko.length ? '  — ' + ko.map((r) => r.name).join(' ; ') : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
