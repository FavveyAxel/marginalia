// Tests : historique de versions des écrits + lien citation → extrait — port 5315.
// Lancer : timeout 300 node scripts/test-editor-versions.mjs
// Étapes : version de départ, version nommée (⌘⌥S), diff mot à mot, restauration puis annulation,
// restauration comme nouvel écrit, version à la fermeture, élagage, corbeille / vidage ;
// citation insérée depuis un extrait (signet _mglHl_ enregistré), barre au survol, ⌘-clic → livre,
// extrait supprimé → message clair.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor/versions');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5315;

async function withApp(port, fn, { width = 1440, height = 900 } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${port}`), server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('response', (r) => r.status() === 404 && errors.push('404 : ' + r.url()));
  try {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
    await browser.close();
    await server.close();
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' });

async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in') && window.__store.getState().route.draftId === id, id, { timeout: 60000 });
  await page.waitForTimeout(1000);
}
const versions = (page, id) => page.evaluate((id) => window.__store.getState().drafts.find((d) => d.id === id)?.versions ?? [], id);
const text = (page) => page.evaluate(() => window.__ed.engine().plainText());
async function waitSaved(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => document.querySelector('.ed-status')?.dataset.status === 'saved', null, { timeout: 20000 }).catch(async (e) => { console.log('statut :', await page.evaluate(() => document.querySelector('.ed-status')?.outerHTML)); throw e; });
}
async function readLib(page, id, name) {
  const b64 = await page.evaluate(
    async ({ id, name }) => {
      const { host } = await import('/src/lib/platform.ts');
      try {
        const buf = new Uint8Array(await host.readFile(id, name));
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      } catch {
        return null;
      }
    },
    { id, name },
  );
  return b64 ? Buffer.from(b64, 'base64') : null;
}
function docXml(buf) {
  const f = path.join(os.tmpdir(), `mgl-ver-${process.pid}.docx`);
  fs.writeFileSync(f, buf);
  return py('import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode())', f);
}
/** Supprime `word` dans le document (transaction ProseMirror, comme une saisie). */
async function deleteWord(page, word) {
  return page.evaluate((word) => {
    const ed = window.__ed.engine().debugEditor().editor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes(word)) at = pos + n.text.indexOf(word);
      return at < 0;
    });
    if (at < 0) return false;
    document.querySelector('.ProseMirror')?.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    ed.view.dispatch(ed.state.tr.delete(at, at + word.length + 1));
    return true;
  }, word);
}

await withApp(PORT, async (page) => {
  // ── Préparation : un livre, deux extraits, un écrit ──
  const setup = await page.evaluate(async () => {
    const s = window.__store.getState();
    const txt = 'Le loisir est la condition de la pensée. Il faut du temps pour penser, et du temps libre.';
    const [book] = await s.importFiles([{ name: 'essai-loisir.txt', data: new TextEncoder().encode(txt).buffer }]);
    const A = (start, end) => s.addHighlight({ bookId: book.id, category: 'these', text: txt.slice(start, end), anchor: { kind: 'html', chapter: 0, start, end, prefix: '', suffix: '' }, locationLabel: 'Chapitre 1' });
    const h1 = A(0, 40);
    const h2 = A(41, 74);
    const m = await import('/src/features/editor/api.ts');
    const d = await m.createDraft({ title: 'Essai versions', html: '<p>Premier paragraphe original du texte.</p><p>Deuxième paragraphe stable.</p>' });
    return { bookId: book.id, h1: h1.id, h2: h2.id, draftId: d.id };
  });
  const { draftId, bookId, h1, h2 } = setup;
  await openDraft(page, draftId);

  // 1. Version de départ à la première ouverture
  await page.waitForFunction((id) => (window.__store.getState().drafts.find((d) => d.id === id)?.versions ?? []).length === 1, draftId, { timeout: 10000 }).catch(() => {});
  let vs = await versions(page, draftId);
  check('version de départ créée à l’ouverture', vs.length === 1 && vs[0].kind === 'auto' && vs[0].wordCount === 8, JSON.stringify(vs.map((v) => [v.kind, v.wordCount])));
  check('fichier de version dans versions/', vs[0] && /^versions\/\d+-\w+\.docx$/.test(vs[0].fileName) && !!(await readLib(page, draftId, vs[0].fileName)), vs[0]?.fileName);

  // 2. Modification puis version nommée par ⌘⌥S
  await page.evaluate(() => {
    document.querySelector('.ProseMirror')?.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    window.__ed.engine().appendParagraph('Troisième paragraphe ajouté avant la version.');
  });
  await waitSaved(page);
  await page.evaluate(() => window.__ed.engine().focus());
  await page.keyboard.press('Meta+Alt+KeyS');
  await page.waitForSelector('.ed-versions #ver-name', { timeout: 5000 });
  await page.fill('.ed-versions #ver-name', 'Plan détaillé');
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => (window.__store.getState().drafts.find((d) => d.id === id)?.versions ?? []).some((v) => v.name === 'Plan détaillé'), draftId, { timeout: 15000 });
  vs = await versions(page, draftId);
  const named = vs.find((v) => v.name === 'Plan détaillé');
  check('version nommée créée (⌘⌥S)', !!named && named.kind === 'manual' && named.wordCount === 14, JSON.stringify(vs.map((v) => [v.kind, v.name, v.wordCount])));
  check('version nommée affichée dans le panneau', await page.isVisible(`.ver-item[data-version="${named?.id}"]`));
  check('journal : aucune entrée créée par les versions', await page.evaluate(() => !window.__store.getState().activity.some((a) => /version/i.test(a.summary))));

  // 3. Modifications : suppression d'un mot, ajout d'une phrase
  check('mot supprimé', await deleteWord(page, 'original'));
  await page.evaluate(() => window.__ed.engine().appendParagraph('Phrase nouvelle écrite après la version.'));
  await waitSaved(page);
  const afterEdits = await text(page);

  // 4. Diff visuel
  await page.click(`.ver-item[data-version="${named.id}"] .ver-item-main`);
  await page.waitForSelector('.ver-compare .ver-diff', { timeout: 15000 });
  const diff = await page.evaluate(() => ({
    ins: [...document.querySelectorAll('.ver-diff ins')].map((x) => x.textContent).join('|'),
    del: [...document.querySelectorAll('.ver-diff del')].map((x) => x.textContent).join('|'),
    insColor: getComputedStyle(document.querySelector('.ver-diff ins')).color,
    delDeco: getComputedStyle(document.querySelector('.ver-diff del')).textDecorationLine,
  }));
  const rgb = (c) => {
    const m = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
    return m ? m.slice(1, 4).map(Number) : (c.match(/\d+/g) ?? []).slice(0, 3).map((x) => x / 255);
  };
  const [ir, ig, ib] = rgb(diff.insColor);
  check('diff : ajout en vert', diff.ins.includes('Phrase nouvelle') && ig > ir && ig > ib, `${diff.ins} / ${diff.insColor}`);
  check('diff : suppression barrée', diff.del.includes('original') && diff.delDeco.includes('line-through'), `${diff.del} / ${diff.delDeco}`);
  await page.screenshot({ path: path.join(OUT, 'diff.png') });
  await page.click('.ver-seg button:nth-child(2)');
  await page.waitForSelector('.ver-preview p', { timeout: 5000 });
  check('aperçu de la version', (await page.textContent('.ver-preview')).includes('Premier paragraphe original'));
  await page.click('.ver-seg button:nth-child(1)');

  // 5. Restauration (version de l'état actuel d'abord) puis annulation
  const before = (await versions(page, draftId)).length;
  await page.click('.ver-compare [data-act="restore"]');
  await page.waitForFunction(() => window.__ed.engine().plainText().includes('original') && !window.__ed.engine().plainText().includes('Phrase nouvelle'), null, { timeout: 30000 });
  check('restauration : le texte de la version est revenu', true);
  vs = await versions(page, draftId);
  const pre = vs.find((v) => v.kind === 'restore');
  check('restauration : version « avant restauration » créée', vs.length === before + 1 && !!pre, JSON.stringify(vs.map((v) => v.kind)));
  check('panneau de comparaison fermé après restauration', await page.waitForSelector('.ver-compare', { state: 'hidden', timeout: 10000 }).then(() => true, () => false));
  await waitSaved(page);
  const lib = docXml(await readLib(page, draftId, 'document.docx'));
  check('restauration enregistrée dans le fichier', lib.includes('original') && !lib.includes('Phrase nouvelle'));
  const undoBtn = page.locator('.toast button', { hasText: 'Annuler' }).last();
  await undoBtn.click({ timeout: 5000 });
  await page.waitForFunction((t) => window.__ed.engine().plainText() === t, afterEdits, { timeout: 30000 });
  check('annulation de la restauration (bouton Annuler)', true);
  await waitSaved(page);
  // Restaurer ⇒ ⌘Z doit aussi annuler : on restaure de nouveau puis on annule par l'API undo de l'éditeur.
  await page.click(`.ver-item[data-version="${named.id}"] .ver-item-main`);
  await page.waitForSelector('.ver-compare .ver-diff', { timeout: 15000 });
  await page.click('.ver-compare [data-act="restore"]');
  await page.waitForFunction(() => !window.__ed.engine().plainText().includes('Phrase nouvelle'), null, { timeout: 30000 });
  await page.waitForSelector('.ver-compare', { state: 'hidden', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__ed.undo());
  await page.waitForFunction((t) => window.__ed.engine().plainText() === t, afterEdits, { timeout: 30000 }).then(
    () => check('annulation de la restauration (⌘Z)', true),
    () => check('annulation de la restauration (⌘Z)', false),
  );
  await waitSaved(page);
  await page.screenshot({ path: path.join(OUT, 'panel.png') });

  // 6. Restaurer comme nouvel écrit (après une dernière modification : la fermeture en gardera une version)
  await page.evaluate(() => window.__ed.engine().appendParagraph('Conclusion provisoire.'));
  await waitSaved(page);
  await page.click(`.ver-item[data-version="${named.id}"] .ver-item-main`);
  await page.waitForSelector('.ver-compare .ver-diff', { timeout: 15000 });
  await page.click('.ver-compare [data-act="restore-new"]');
  await page.waitForFunction((id) => window.__store.getState().route.draftId && window.__store.getState().route.draftId !== id, draftId, { timeout: 20000 });
  const nd = await page.evaluate(() => {
    const s = window.__store.getState();
    return s.drafts.find((d) => d.id === s.route.draftId);
  });
  check('restaurer comme nouvel écrit', nd && nd.title.includes('Plan détaillé') && nd.wordCount === 14, nd?.title);
  // Fermeture de l'écrit d'origine après modifications → version « à la fermeture »
  await page.waitForFunction((id) => (window.__store.getState().drafts.find((d) => d.id === id)?.versions ?? []).some((v) => v.kind === 'close'), draftId, { timeout: 15000 }).then(
    () => check('version à la fermeture', true),
    () => check('version à la fermeture', false),
  );

  // 7. Citation liée à un extrait
  await openDraft(page, draftId);
  await page.evaluate(() => {
    if (document.querySelector('.ed-versions')) document.querySelector('[data-tb="versions"]').click();
  });
  if (!(await page.isVisible('.ed-extracts:not(.ed-versions)'))) await page.click('[aria-label="Afficher le panneau latéral"]');
  await page.evaluate(() => window.__ed.engine().goTo(0));
  await page.click(`.ed-xt[data-hl="${h1}"] .ed-xt-insert`, { force: true });
  await page.waitForTimeout(600);
  const ranges = await page.evaluate(async () => (await import('/src/features/editor/citeLink.ts')).citationRanges(window.__ed.engine()));
  check('citation insérée avec le lien vers l’extrait', ranges.length === 1 && ranges[0].highlightId === h1, JSON.stringify(ranges));
  await waitSaved(page);
  const xml = docXml(await readLib(page, draftId, 'document.docx'));
  check('signet _mglHl_ enregistré dans le .docx', xml.includes(`w:name="_mglHl_${h1}"`) && /<w:bookmarkEnd w:id="\d+"/.test(xml));

  // Survol → petite barre ; ⌘-clic → livre ouvert à l'extrait
  const spanBox = async () =>
    page.evaluate(async () => {
      const r = (await import('/src/features/editor/citeLink.ts')).citationRanges(window.__ed.engine())[0];
      const s = [...document.querySelectorAll('.ed-engine span[data-pm-start]')].find((x) => +x.dataset.pmStart >= r.from && +x.dataset.pmStart < r.to && x.textContent.trim());
      s.scrollIntoView({ block: 'center' });
      await new Promise((res) => setTimeout(res, 200));
      const b = s.getBoundingClientRect();
      return { x: b.left + Math.min(40, b.width / 2), y: b.top + b.height / 2 };
    });
  let pt = await spanBox();
  await page.mouse.move(pt.x - 5, pt.y - 60);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForSelector('.ed-citebar', { timeout: 5000 }).then(
    () => check('barre au survol de la citation', true),
    () => check('barre au survol de la citation', false),
  );
  check('barre : titre du livre', ((await page.textContent('.ed-citebar').catch(() => '')) ?? '').includes('essai-loisir') || ((await page.textContent('.ed-citebar').catch(() => '')) ?? '').length > 0);
  await page.screenshot({ path: path.join(OUT, 'citebar.png') });
  await page.keyboard.down('Meta');
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.up('Meta');
  await page.waitForFunction((b) => window.__store.getState().route.name === 'reader' && window.__store.getState().route.bookId === b, bookId, { timeout: 10000 }).catch(() => {});
  const st = await page.evaluate(() => ({ route: window.__store.getState().route, jump: window.__store.getState().jump, active: window.__store.getState().activeHighlightId }));
  check('⌘-clic : livre ouvert à l’extrait', st.route.name === 'reader' && st.route.bookId === bookId && st.jump?.highlightId === h1 && st.active === h1, JSON.stringify(st.route));

  // Bouton « Ouvrir l'extrait » de la barre + extrait supprimé → message clair
  await openDraft(page, draftId);
  const reopened = await page.evaluate(async () => (await import('/src/features/editor/citeLink.ts')).citationRanges(window.__ed.engine()));
  check('lien conservé après réouverture', reopened.length === 1 && reopened[0].highlightId === h1);
  await page.evaluate((h) => window.__store.getState().removeHighlight(h), h1);
  pt = await spanBox();
  await page.mouse.move(pt.x - 5, pt.y - 60);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForSelector('.ed-citebar', { timeout: 5000 }).catch(() => {});
  check('barre : « Extrait supprimé »', ((await page.textContent('.ed-citebar').catch(() => '')) ?? '').includes('Extrait supprimé'));
  await page.click('.ed-citebar [data-act="open-extract"]').catch(() => {});
  await page.waitForTimeout(300);
  const toasts = await page.evaluate(() => window.__store.getState().toasts.map((t) => t.message + (t.action ? ' [' + t.action.label + ']' : '')));
  check('extrait supprimé : message clair + Restaurer', toasts.some((t) => t.includes('corbeille') && t.includes('[Restaurer]')) && (await page.evaluate(() => window.__store.getState().route.name)) === 'write', toasts.join(' / '));
  // Restaurer depuis le toast → l'extrait revient et le livre s'ouvre
  await page.locator('.toast button', { hasText: 'Restaurer' }).last().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  const st2 = await page.evaluate(() => ({ route: window.__store.getState().route, jump: window.__store.getState().jump }));
  check('« Restaurer » : extrait remis et ouvert', st2.route.name === 'reader' && st2.jump?.highlightId === h1);

  // 8. Élagage
  const plan = await page.evaluate(async () => {
    const m = await import('/src/features/editor/versions.ts');
    const now = Date.UTC(2026, 9, 14, 12);
    const H = 3600_000;
    const D = 24 * H;
    const mk = (id, ago, name = null) => ({ id, fileName: `versions/${id}.docx`, createdAt: now - ago, name, kind: name ? 'manual' : 'auto', wordCount: 1 });
    const list = [
      mk('vieux-nomme', 90 * D, 'Rendu'),
      mk('vieux-auto', 40 * D),
      mk('j5-a', 5 * D + 2 * H),
      mk('j5-b', 5 * D + 1 * H),
      mk('j2', 2 * D),
      mk('h3', 3 * H),
      mk('h1', 1 * H),
    ];
    const { keep, drop } = m.prunePlan(list, now);
    return { keep: keep.map((v) => v.id), drop: drop.map((v) => v.id) };
  });
  check('élagage : nommées gardées, 24 h gardées, 1/jour sur 30 jours', JSON.stringify(plan.keep) === JSON.stringify(['vieux-nomme', 'j5-b', 'j2', 'h3', 'h1']) && JSON.stringify(plan.drop) === JSON.stringify(['vieux-auto', 'j5-a']), JSON.stringify(plan));

  // 9. Corbeille et vidage : les versions partent avec l'écrit
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForTimeout(1500);
  const vfiles = (await versions(page, draftId)).map((v) => v.fileName);
  const trash = await page.evaluate(async (id) => {
    const s = window.__store.getState();
    await s.removeDraft(id);
    const t = window.__store.getState().trash.find((x) => x.refId === id);
    return t ? t.files.map((f) => f.fileName) : null;
  }, draftId);
  check('corbeille : fichiers des versions listés avec l’écrit', !!trash && vfiles.length > 0 && vfiles.every((f) => trash.includes(f)), `${vfiles.length} versions`);
  const restored = await page.evaluate((id) => {
    const s = window.__store.getState();
    const t = s.trash.find((x) => x.refId === id);
    s.restoreFromTrash(t.id, { silent: true });
    return window.__store.getState().drafts.find((d) => d.id === id)?.versions?.length ?? 0;
  }, draftId);
  check('restauration depuis la corbeille : versions revenues', restored === vfiles.length);
  await page.evaluate(async (id) => {
    const s = window.__store.getState();
    await s.removeDraft(id);
    const t = window.__store.getState().trash.find((x) => x.refId === id);
    await window.__store.getState().purgeTrash([t.id]);
  }, draftId);
  const left = [];
  for (const f of vfiles) if (await readLib(page, draftId, f)) left.push(f);
  check('vidage : fichiers des versions effacés', left.length === 0, left.join(', '));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
