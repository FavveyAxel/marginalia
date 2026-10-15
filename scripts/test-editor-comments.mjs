// Tests : commentaires en marge (vrais commentaires Word) — port 5395.
// Lancer : timeout 600 node scripts/test-editor-comments.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/editor-comments');
const OUT = path.join(SHOTS, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5395;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' });
const DOCX_PY = `
import sys, zipfile, re, json
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
doc = z.read('word/document.xml').decode('utf8')
cm = z.read('word/comments.xml').decode('utf8') if 'word/comments.xml' in names else ''
txt = lambda x: re.sub(r'<[^>]+>', '', x)
comments = [dict(id=m.group(1), author=(re.search(r'w:author="([^"]*)"', m.group(0)) or [None, ''])[1], text=txt(m.group(2)).strip()) for m in re.finditer(r'<w:comment\\b[^>]*w:id="([^"]+)"[^>]*>(.*?)</w:comment>', cm, re.S)]
starts = re.findall(r'<w:commentRangeStart [^>]*w:id="([^"]+)"', doc)
refs = re.findall(r'<w:commentReference [^>]*w:id="([^"]+)"', doc)
ok = True
try:
    import docx
    docx.Document(sys.argv[1])
except Exception as e:
    ok = str(e)
rels = z.read('word/_rels/document.xml.rels').decode('utf8')
ct = z.read('[Content_Types].xml').decode('utf8')
print(json.dumps(dict(comments=comments, starts=starts, refs=refs, pydocx=ok, rel='comments.xml' in rels, ct='comments+xml' in ct, ext='word/commentsExtended.xml' in names), ensure_ascii=False))
`;
const inspectDocx = (file) => JSON.parse(py(DOCX_PY, file));

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 600)));
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').endsWith('/favicon.ico') && errors.push('console: ' + m.text()));

const shot = (name) => page.screenshot({ path: path.join(SHOTS, name) });
async function openDraft(id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}
/** Sélectionne le texte `needle` (dans le moteur) ; renvoie [from, to]. */
async function select(needle) {
  const r = await page.evaluate((needle) => {
    const ed = window.__ed.engine().debugEditor().editor;
    let r = null;
    ed.state.doc.descendants((n, pos) => {
      if (r) return false;
      if (n.isText && n.text.includes(needle)) r = [pos + n.text.indexOf(needle), pos + n.text.indexOf(needle) + needle.length];
      return true;
    });
    if (!r) return null;
    ed.view.focus();
    ed.commands.setTextSelection({ from: r[0], to: r[1] });
    return r;
  }, needle);
  if (!r) throw new Error('introuvable : ' + needle);
  await page.waitForTimeout(350);
  return r;
}
async function caretIn(needle) {
  const [from] = await select(needle);
  await page.evaluate((p) => {
    const ed = window.__ed.engine().debugEditor().editor;
    ed.commands.setTextSelection({ from: p + 2, to: p + 2 });
  }, from);
  await page.waitForTimeout(300);
}
const list = () => page.evaluate(() => window.__ed.engine().listComments());
const bubbles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-col .cm-bubble')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.cmId, top: r.top, bottom: r.bottom, left: r.left, right: r.right, cls: b.className, text: b.textContent };
    }),
  );
const rectsOf = (from, to) => page.evaluate(({ from, to }) => window.__ed.engine().rangeRects(from, to), { from, to });
async function exportVia(fmt, file) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    (async () => {
      await page.click('.ed-topbar [data-tb="export"]:has-text("Exporter")');
      await page.click(`.ed-export-menu [data-fmt="${fmt}"]`);
    })(),
  ]);
  const p = path.join(OUT, file);
  await dl.saveAs(p);
  return p;
}
async function newComment(needle, text, via = 'bar') {
  const [from, to] = await select(needle);
  if (via === 'bar') {
    await page.waitForSelector('.ed-selbar [data-sb="comment"]', { timeout: 5000 });
    await page.click('.ed-selbar [data-sb="comment"]');
  } else {
    await page.keyboard.press('Control+Alt+KeyM');
  }
  await page.waitForSelector('.cm-bubble.pending textarea', { timeout: 5000 });
  const focused = await page
    .waitForFunction(() => document.activeElement?.dataset?.cm === 'new', null, { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  return { from, to, focused };
}
const noOverlap = (bs) => {
  const s = [...bs].sort((a, b) => a.top - b.top);
  for (let i = 1; i < s.length; i++) if (s[i].top < s[i - 1].bottom + 2) return false;
  return true;
};

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 90000 });
  await page.evaluate(() => {
    localStorage.removeItem('marginalia.ed.commentsShown');
    localStorage.removeItem('marginalia.ed.commentsResolved');
    window.__store.getState().setTheme?.('light');
    document.documentElement.dataset.theme = 'light';
  });
  const html = [
    '<h1>La liberté chez Rousseau</h1>',
    '<p>Introduction. Le Contrat social s’ouvre sur un paradoxe : comment l’homme, né libre, peut-il consentir à l’autorité sans perdre sa liberté ? La réponse de Rousseau tient dans une formule devenue célèbre, et dans une construction patiente du concept de souveraineté.</p>',
    '<p>Nous suivrons trois moments : la thèse de départ, la distinction des volontés, puis les objections libérales.</p>',
    '<p>Rousseau soutient que l’homme naît libre, et partout il est dans les fers : c’est une thèse discutable mais féconde, qui ouvre tout le Contrat social.</p>',
    '<p>La volonté générale ne se confond pas avec la volonté de tous. Elle vise l’intérêt commun, quand la seconde additionne des intérêts particuliers.</p>',
    '<p>On peut objecter que cette distinction reste abstraite ; Constant y verra la source d’un despotisme au nom du peuple.</p>',
    '<p>Pourtant, l’idée d’autonomie — obéir à la loi qu’on s’est prescrite — demeure le cœur de la liberté moderne.</p>',
  ].join('');
  const d = await page.evaluate(async (html) => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Commentaires', html }), html);
  await openDraft(d.id);

  // ── 0. Aucune colonne sans commentaire ──
  check('pas de colonne de marge sans commentaire', !(await page.$('.cm-col')) && !(await page.evaluate(() => document.querySelector('.ed-root').classList.contains('ed-cm-on'))));
  const pageRightBefore = await page.evaluate(() => document.querySelector('.superdoc-page').getBoundingClientRect().right);

  // ── 1. Barre de sélection → bulle, alignée, champ focalisé ──
  const c1 = await newComment('thèse discutable', 'À nuancer avec Kant.');
  check('« Commenter » (barre de sélection) : champ de la bulle focalisé', c1.focused);
  let ls = await list();
  check('commentaire Word créé sur le passage', ls.length === 1 && ls[0].quote === 'thèse discutable' && ls[0].text === 'À nuancer avec Kant.' && ls[0].mine, JSON.stringify(ls));
  await page.waitForTimeout(400);
  let bs = await bubbles();
  const r1 = await rectsOf(c1.from, c1.to);
  const pageR = await page.evaluate(() => document.querySelector('.superdoc-page').getBoundingClientRect());
  check('bulle dans la marge droite, à droite de la page', bs.length === 1 && bs[0].left > pageR.right + 4, JSON.stringify({ b: bs[0]?.left, p: pageR.right }));
  const side = await page.evaluate(() => {
    const s = document.querySelector('.ed-side');
    const sc = document.querySelector('.ed-scroll');
    return { left: s ? s.getBoundingClientRect().left : 99999, hscroll: sc.scrollWidth > sc.clientWidth + 1 };
  });
  check('colonne : ne chevauche pas le panneau latéral, pas de défilement horizontal', bs[0].right < side.left - 8 && !side.hscroll, JSON.stringify({ right: bs[0].right, side }));
  check('bulle alignée sur la ligne du passage', bs.length === 1 && Math.abs(bs[0].top - r1[0].top) < 14, `${bs[0]?.top} vs ${r1[0]?.top}`);
  check('« ajuster à la largeur » : la page se resserre pour la colonne', pageR.right < pageRightBefore - 100, `${pageRightBefore} → ${pageR.right}`);
  check('bulle : auteur « Vous » + date relative', /Vous/.test(bs[0].text) && /à l’instant/.test(bs[0].text), bs[0].text);
  const hl = await page.evaluate(() => {
    const el = document.querySelector('.ed-engine .superdoc-comment-highlight');
    return el ? { bg: getComputedStyle(el).backgroundColor, ids: el.dataset.commentIds } : null;
  });
  check('passage commenté teinté dans la page', hl && hl.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(hl));
  check('compteur dans la barre du haut', (await page.textContent('.ed-cm-toggle .ed-cm-count').catch(() => '')) === '1');
  const ui = await page.evaluate(() => ({
    native: [...document.querySelectorAll('.superdoc-comments-layer, .comments-dialog, .floating-comment, .sd-comment-box, .superdoc__comments')].filter((e) => e.offsetParent).length,
  }));
  check('pas d’interface de commentaires native de SuperDoc', ui.native === 0, JSON.stringify(ui));

  // ── 2. Surbrillance croisée ──
  await page.click('.ed-engine', { position: { x: 5, y: 5 } }).catch(() => {});
  await caretIn('volonté de tous');
  await page.waitForTimeout(300);
  const hlBox = await page.evaluate(() => {
    const r = document.querySelector('.ed-engine .superdoc-comment-highlight').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(hlBox.x, hlBox.y);
  await page.waitForTimeout(300);
  const hotFromText = await page.evaluate(() => ({ hot: !!document.querySelector('.cm-bubble.hot'), link: !!document.querySelector('.cm-links .cm-link') }));
  check('survol du passage : bulle mise en avant + trait d’ancrage', hotFromText.hot && hotFromText.link, JSON.stringify(hotFromText));
  await page.mouse.move(10, 600);
  await page.waitForTimeout(300);
  const baseBg = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-engine .superdoc-comment-highlight')).backgroundColor);
  await page.hover('.cm-bubble');
  await page.waitForTimeout(300);
  const hotFromBubble = await page.evaluate(() => {
    const el = document.querySelector('.ed-engine .superdoc-comment-highlight');
    return { bg: getComputedStyle(el).backgroundColor, link: !!document.querySelector('.cm-links .cm-link') };
  });
  check('survol de la bulle : passage plus marqué', hotFromBubble.bg !== baseBg && hotFromBubble.link, `${baseBg} → ${hotFromBubble.bg}`);
  await shot('clair-une-bulle.png');

  // ── 3. Répondre ──
  await page.click('.cm-bubble .cm-text');
  await page.waitForSelector('.cm-bubble.active [data-cm="reply"]');
  await page.click('.cm-bubble.active [data-cm="reply"]');
  await page.keyboard.type('Oui : voir la Critique de la raison pratique.');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Et la Doctrine du droit.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ls = await list();
  check('réponse ajoutée au fil (⇧Entrée = retour à la ligne)', ls.length === 2 && ls[1].parentId === ls[0].id && ls[1].text.includes('\n'), JSON.stringify(ls.map((c) => c.text)));
  check('réponse affichée dans la bulle', (await page.$$('.cm-bubble.active .cm-reply')).length === 1);
  await page.click('.cm-bubble.active [data-cm="reply"]');
  await page.keyboard.type('Bonne idée.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await shot('clair-fil-de-reponses.png');

  // ── 4. Raccourci + commentaires proches ──
  const c2 = await newComment('volonté générale', 'Définir précisément.', 'key');
  check('⌘⌥M : commentaire créé (champ focalisé)', c2.focused && (await list()).filter((c) => !c.parentId).length === 2);
  await newComment('intérêt commun', 'Exemple ?', 'bar');
  await newComment('intérêts particuliers', 'Opposition à développer dans la partie II, avec un exemple tiré de la vie politique.', 'bar');
  await page.mouse.click(300, 860).catch(() => {});
  await caretIn('autonomie');
  await page.waitForTimeout(600);
  bs = await bubbles();
  check('quatre bulles, empilées sans chevauchement', bs.length === 4 && noOverlap(bs), JSON.stringify(bs.map((b) => [Math.round(b.top), Math.round(b.bottom)])));
  // la bulle active reste alignée sur son passage
  const roots = (await list()).filter((c) => !c.parentId);
  const mid = roots.find((c) => c.quote === 'intérêt commun');
  await page.click(`.cm-bubble[data-cm-id="${mid.id}"] .cm-text`);
  await page.waitForTimeout(500);
  bs = await bubbles();
  const rm = await rectsOf(mid.from, mid.to);
  const bm = bs.find((b) => b.id === mid.id);
  check('bulle active alignée sur sa ligne, les autres s’écartent', bm && Math.abs(bm.top - rm[0].top) < 14 && noOverlap(bs), `${bm?.top} vs ${rm[0]?.top}`);
  await shot('clair-plusieurs-bulles.png');

  // ── 5. Modifier ──
  await page.click(`.cm-bubble[data-cm-id="${mid.id}"] [data-cm="menu"]`);
  await page.click('.cm-menu [data-cm="edit"]');
  await page.waitForFunction(() => document.activeElement?.matches?.('textarea[data-cm="edit"]'));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Exemple : la loi votée.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('modifier un commentaire', (await list()).find((c) => c.id === mid.id)?.text === 'Exemple : la loi votée.');

  // ── 6. Résoudre, filtre ──
  await page.hover(`.cm-bubble[data-cm-id="${mid.id}"]`);
  await page.click(`.cm-bubble[data-cm-id="${mid.id}"] [data-cm="resolve"]`);
  await page.waitForTimeout(500);
  check('résolu : fil marqué résolu et masqué', (await list()).find((c) => c.id === mid.id)?.resolved && !(await page.$(`.cm-bubble[data-cm-id="${mid.id}"]`)));
  check('compteur : commentaires ouverts seulement', (await page.textContent('.ed-cm-toggle .ed-cm-count')) === '3');
  await page.click('[data-cm="filter-resolved"]');
  await page.waitForTimeout(400);
  check('filtre « résolus » : bulle repliée et estompée', await page.evaluate((id) => {
    const b = document.querySelector(`.cm-bubble[data-cm-id="${id}"]`);
    return !!b && b.classList.contains('resolved') && Number(getComputedStyle(b).opacity) < 0.9;
  }, mid.id));
  await page.click(`.cm-bubble[data-cm-id="${mid.id}"] [data-cm="reopen"]`);
  await page.waitForTimeout(300);
  check('rouvrir', !(await list()).find((c) => c.id === mid.id)?.resolved);
  await page.click(`.cm-bubble[data-cm-id="${mid.id}"] [data-cm="resolve"]`);
  await page.waitForTimeout(300);

  // ── 7. Supprimer + annuler ──
  const last = roots.find((c) => c.quote === 'intérêts particuliers');
  await page.click(`.cm-bubble[data-cm-id="${last.id}"] [data-cm="menu"]`);
  await page.click('.cm-menu [data-cm="delete"]');
  await page.waitForTimeout(400);
  check('supprimer : fil retiré (passage et bulle)', !(await list()).some((c) => c.id === last.id) && !(await page.$(`.cm-bubble[data-cm-id="${last.id}"]`)));
  await page.click('.toast .toast-action:has-text("Annuler")');
  await page.waitForTimeout(500);
  ls = await list();
  check('« Annuler » : commentaire remis sur son passage', ls.some((c) => c.id === last.id && c.quote === 'intérêts particuliers'));

  // ── 8. Échap annule un commentaire vide ──
  await select('Constant');
  await page.keyboard.press('Control+Alt+KeyM');
  await page.waitForSelector('.cm-bubble.pending textarea');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Échap sur une bulle vide : annulée', !(await page.$('.cm-bubble.pending')));
  await caretIn('autonomie');
  await page.mouse.move(600, 700);

  // ── 9. Thèmes ──
  for (const theme of ['dark', 'sepia']) {
    await page.evaluate((t) => {
      window.__store.getState().setTheme?.(t);
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(600);
    const first = roots[0];
    await page.click(`.cm-bubble[data-cm-id="${first.id}"] .cm-text`);
    await page.waitForTimeout(400);
    await shot(`${theme === 'dark' ? 'sombre' : 'sepia'}.png`);
  }
  const tints = await page.evaluate(async () => {
    const out = {};
    for (const t of ['light', 'sepia', 'dark']) {
      document.documentElement.dataset.theme = t;
      await new Promise((r) => setTimeout(r, 450));
      const el = document.querySelector('.ed-engine .superdoc-comment-highlight');
      out[t] = el ? getComputedStyle(el).backgroundColor : null;
    }
    return out;
  });
  check('teinte du passage adaptée aux thèmes', new Set(Object.values(tints)).size === 3, JSON.stringify(tints));
  await page.evaluate(() => {
    window.__store.getState().setTheme?.('light');
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(400);

  // ── 10. Afficher / masquer ──
  await page.click('.ed-cm-toggle');
  await page.waitForTimeout(400);
  const hidden = await page.evaluate(() => ({ col: !!document.querySelector('.cm-col'), bg: getComputedStyle(document.querySelector('.ed-engine .superdoc-comment-highlight')).backgroundColor }));
  check('bouton : commentaires masqués (colonne et teinte)', !hidden.col && hidden.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(hidden));
  await page.click('.ed-cm-toggle');
  await page.waitForTimeout(400);
  check('bouton : commentaires réaffichés', !!(await page.$('.cm-col')));

  // ── 11. Mode concentration ──
  await caretIn('autonomie');
  await page.keyboard.press('Control+Shift+KeyF');
  await page.waitForTimeout(400);
  await page.mouse.move(600, 450);
  await page.keyboard.press('End');
  await page.keyboard.type(' Ajout.', { delay: 20 });
  await page.waitForTimeout(1000);
  const focusOp = await page.evaluate(() => ({ col: Number(getComputedStyle(document.querySelector('.cm-col')).opacity), pe: getComputedStyle(document.querySelector('.cm-col')).pointerEvents }));
  check('mode concentration : bulles effacées pendant la frappe', focusOp.col < 0.05 && focusOp.pe === 'none', JSON.stringify(focusOp));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Shift+KeyF');
  await page.waitForTimeout(400);

  // ── 12. Enregistrement puis réouverture ──
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__ed.save());
  await page.waitForTimeout(800);
  const before = (await list()).map((c) => `${c.quote}|${c.text}|${c.resolved}|${!!c.parentId}`).sort();
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForTimeout(800);
  await openDraft(d.id);
  await page.waitForTimeout(800);
  const after = (await list()).map((c) => `${c.quote}|${c.text}|${c.resolved}|${!!c.parentId}`).sort();
  check('réouverture : commentaires, réponses et état résolu conservés', JSON.stringify(before) === JSON.stringify(after) && after.length === 6, JSON.stringify(after));
  check('réouverture : bulles affichées (résolus visibles : filtre conservé)', (await bubbles()).length === 4);

  // ── 13. Exports ──
  const docxPath = await exportVia('docx', 'commentaires.docx');
  const dx = inspectDocx(docxPath);
  const texts = dx.comments.map((c) => c.text);
  check(
    'export Word : w:comments (racines et réponses) + ancrages dans le texte',
    dx.rel && dx.ct && texts.includes('À nuancer avec Kant.') && texts.some((t) => t.startsWith('Oui : voir')) && dx.comments.length === 6 && dx.starts.length >= 3 && dx.refs.length >= 3,
    JSON.stringify({ n: dx.comments.length, starts: dx.starts.length, refs: dx.refs.length, rel: dx.rel, ct: dx.ct }),
  );
  check('export Word : fichier lisible (python-docx)', dx.pydocx === true, String(dx.pydocx));
  for (const [fmt, file] of [['md', 'export.md'], ['html', 'export.html'], ['txt', 'export.txt']]) {
    const t = fs.readFileSync(await exportVia(fmt, file), 'utf8');
    check(`export ${fmt.toUpperCase()} : sans commentaire`, t.includes('volonté générale') && !t.includes('Kant') && !t.includes('Définir précisément'), `${t.length} car.`);
  }
  await page.evaluate(async () => {
    const { host } = await import('/src/lib/platform.ts');
    window.__printed = null;
    host.printToPdf = async (html) => {
      window.__printed = html;
      return new TextEncoder().encode('%PDF-1.4 test').buffer;
    };
  });
  await exportVia('pdf', 'export.pdf');
  const printed = await page.evaluate(() => window.__printed);
  check('export PDF : sans commentaire', printed && printed.includes('volonté générale') && !printed.includes('Kant'), printed ? `${printed.length} car.` : 'rien');

  // ── 14. Ouvrir un .docx contenant des commentaires Word ──
  const b64 = fs.readFileSync(docxPath).toString('base64');
  const d2 = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    return (await import('/src/features/editor/api.ts')).createDraft({ title: 'Importé', docx: data });
  }, b64);
  await openDraft(d2.id);
  await page.waitForTimeout(800);
  const imp = await list();
  check('.docx avec commentaires Word : affichés à l’ouverture', imp.length === 6 && (await bubbles()).length === 4 && imp.some((c) => c.text.includes('\n')) && imp.some((c) => c.text === 'À nuancer avec Kant.'), JSON.stringify(imp.map((c) => c.text)));

  // ── 15. Commentaire d'un autre auteur (fichier Word externe) ──
  const foreign = py(
    `
import sys, docx, base64, io
d = docx.Document()
p = d.add_paragraph('Un texte relu par une autre personne, avec une remarque.')
try:
    d.add_comment(p.runs[0], text='Reformuler cette phrase.', author='Claire Martin', initials='CM')
except Exception as e:
    pass
b = io.BytesIO(); d.save(b); print(base64.b64encode(b.getvalue()).decode())
`,
  ).trim();
  const d3 = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    return (await import('/src/features/editor/api.ts')).createDraft({ title: 'Relu', docx: data });
  }, foreign);
  await openDraft(d3.id);
  await page.waitForTimeout(800);
  const fl = await list();
  if (fl.length) {
    const fb = (await bubbles())[0];
    const sideL = await page.evaluate(() => document.querySelector('.ed-side')?.getBoundingClientRect().left ?? 99999);
    check('autre format de page : colonne toujours à côté du panneau latéral', fb && fb.right < sideL - 8, `${fb?.right} / ${sideL}`);
    check('commentaire d’un autre auteur : nom affiché', fl[0].author === 'Claire Martin' && !fl[0].mine && /Claire Martin/.test((await bubbles())[0]?.text || ''), JSON.stringify(fl[0]));
    await shot('clair-autre-auteur.png');
  } else console.log('(python-docx sans add_comment : test « autre auteur » ignoré)');
} finally {
  const rel = [...new Set(errors)].filter((e) => !/404 \(Not Found\)/.test(e));
  if (rel.length) console.log('ERREURS NAVIGATEUR:\n' + rel.join('\n'));
  check('aucune erreur navigateur', rel.length === 0);
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
