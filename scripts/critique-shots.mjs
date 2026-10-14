// Relecture globale : parcours complet de l'app avec des données réalistes, captures de chaque vue
// en clair / sombre / sépia, à 1440×900 et 1100×720. Port 5290, cacheDir propre.
// Usage : timeout 600 node scripts/critique-shots.mjs <dossier> [--sizes=1440,1100] [--themes=light,dark,sepia] [--only=home,library]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { importFixture } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5290;
const outDir = process.argv[2] || 'shots/critique/avant';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1].split(',').filter(Boolean);
const SIZES = { 1440: { width: 1440, height: 900 }, 1100: { width: 1100, height: 720 } };
const sizes = arg('sizes', '1440,1100');
const themes = arg('themes', 'light,dark,sepia');
const only = arg('only', '');

const tick = (page, ms = 250) => page.waitForTimeout(ms);
const st = (page, fn, a) => page.evaluate(fn, a);

async function clean(page) {
  await page.mouse.move(2, 400);
  await st(page, () => window.__store.setState({ toasts: [] }));
  await tick(page, 200);
}
async function snap(page, name) {
  const out = path.resolve(ROOT, outDir, name + '.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('capture:', path.relative(ROOT, out));
}

/** Sélection réelle à la souris dans le lecteur HTML (volet `pane`). */
async function dragSelect(page, needle, pane = 'a') {
  const pts = await page.evaluate(
    ({ pane, needle }) => {
      const root = [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)].find((r) => r.textContent.includes(needle));
      if (!root) return null;
      const t = root.textContent;
      const i = t.indexOf(needle);
      const at = (off) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          if (off < pos + n.data.length) return [n, off - pos];
          pos += n.data.length;
        }
        return null;
      };
      const [n0] = at(i);
      n0.parentElement.scrollIntoView({ block: 'center' });
      const rectOf = (off) => {
        const [n, o] = at(off);
        const r = document.createRange();
        r.setStart(n, o);
        r.setEnd(n, o + 1);
        return r.getClientRects()[0];
      };
      const a = rectOf(i);
      const b = rectOf(i + needle.length - 1);
      return { x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 };
    },
    { pane, needle },
  );
  if (!pts) throw new Error('dragSelect : texte introuvable ' + needle);
  await tick(page, 150);
  await page.mouse.move(pts.x0, pts.y0);
  await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 4 });
  await page.mouse.move(pts.x1, pts.y1, { steps: 4 });
  await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await tick(page, 150);
}

async function openReader(page, bookId, extra = {}) {
  await st(page, ({ bookId, extra }) => {
    const s = window.__store.getState();
    s.navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId: null, ...extra });
  }, { bookId, extra });
  await page.waitForSelector('.html-doc, .pdf-page', { timeout: 20000 });
  await tick(page, 1400);
}

async function seed(page) {
  await st(page, () => window.__store.getState().updateSettings({ activeWorkspaceId: null, theme: 'light' }));
  const ids = {};
  ids.epub = await importFixture(page, 'fixtures/discours.epub');
  ids.pdf = await importFixture(page, 'fixtures/discours.pdf');
  ids.docx = await importFixture(page, 'fixtures/discours.docx');
  ids.md = await importFixture(page, 'fixtures/discours.md');
  ids.html = await importFixture(page, 'fixtures/discours.html');
  ids.txt = await importFixture(page, 'fixtures/premiere-partie.txt');
  await tick(page, 400);

  // Extraits réels dans l'EPUB (sélection à la souris + raccourci)
  await openReader(page, ids.epub);
  const picks = [
    ['Le bon sens est la chose du monde la mieux partagée', '1'],
    ['la puissance de bien juger et distinguer le vrai d’avec le faux', '5'],
    ['je pense, donc je suis, était si ferme et si assurée', '2'],
    ['ce n’est pas assez d’avoir l’esprit bon, mais le principal est de l’appliquer bien', '3'],
    ['On objectera peut-être que le doute lui-même suppose un langage', '4'],
    ['Je demeurais tout le jour enfermé seul dans un poêle', '6'],
  ];
  for (const [needle, key] of picks) {
    await dragSelect(page, needle);
    await page.keyboard.press(key);
    await tick(page, 300);
  }
  // Note « ma voix » pure (N) puis fermeture du popover
  await dragSelect(page, 'il n’y a pas tant de perfection dans les ouvrages composés de plusieurs pièces');
  await page.keyboard.press('n');
  await tick(page, 500);
  await page.keyboard.press('Escape');
  await tick(page, 200);
  // Mouvements (M) dans la Quatrième partie
  for (const needle of ['Je ne sais si je dois vous entretenir', 'Mais aussitôt après je pris garde', 'Puis, examinant avec attention ce que j’étais']) {
    await dragSelect(page, needle);
    await page.keyboard.press('m');
    await tick(page, 300);
  }
  await st(page, (bookId) => {
    const s = window.__store.getState();
    const hs = s.highlights.filter((h) => h.bookId === bookId);
    const by = (t) => hs.find((h) => h.text.startsWith(t));
    s.updateHighlight(by('Le bon sens').id, { note: 'Ironie probable : chacun s’estime assez pourvu.', noteKind: 'critique', printedPage: '35' });
    s.updateHighlight(by('je pense').id, { note: 'Le cogito résiste au doute hyperbolique : c’est un acte, non une inférence ?', noteKind: 'question', printedPage: '62' });
    s.updateHighlight(by('ce n’est pas').id, { note: 'Avoir de bonnes facultés ne suffit pas : il faut une méthode.', noteKind: 'reformulation', printedPage: '36' });
    s.updateHighlight(by('il n’y a pas tant').id, { note: 'Présuppose que l’unité d’un auteur garantit la cohérence.', noteKind: 'presuppose' });
    const study = s.studies.find((x) => x.bookId === bookId);
    s.patch('studies', study.id, {
      title: 'Quatrième partie, le cogito',
      probleme: 'Existe-t-il une vérité qui résiste au doute le plus radical ?',
      these: 'Le « je pense, donc je suis » est une certitude que le doute lui-même confirme.',
      enjeu: 'Fonder la connaissance sur un premier principe indubitable.',
      movements: study.movements.map((m, i) => ({ ...m, title: ['Le doute méthodique', 'La découverte du cogito', 'Une substance pensante'][i] ?? m.title, role: ['pose le problème', 'établit la thèse', 'tire la conséquence'][i] ?? '' })),
    });
  }, ids.epub);
  ids.studyId = await st(page, (b) => window.__store.getState().studies.find((x) => x.bookId === b).id, ids.epub);

  // PDF : deux extraits réels
  await openReader(page, ids.pdf);
  await tick(page, 1200);
  for (const key of ['3', '2']) {
    const box = await page.evaluate((n) => {
      const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => s.textContent.length > 25 && s.getBoundingClientRect().width > 120 && s.getBoundingClientRect().top > 120);
      const s = spans[n * 3];
      const r = s.getBoundingClientRect();
      return { x: r.left + 2, y: r.top + r.height / 2, w: r.width };
    }, key === '3' ? 1 : 3);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.8, box.y, { steps: 8 });
    await page.mouse.up();
    await tick(page, 400);
    await page.keyboard.press(key);
    await tick(page, 400);
  }

  // Concepts, carte, argument, plan, écrit, cartes, espaces
  await st(page, ({ epub, pdf }) => {
    const s = window.__store.getState();
    const hs = s.highlights.filter((h) => h.bookId === epub);
    const by = (t) => hs.find((h) => h.text.startsWith(t));
    const now = Date.now();
    const raison = s.addConcept('Raison', 'Puissance de bien juger et de distinguer le vrai du faux.');
    const doute = s.addConcept('Doute', 'Suspension du jugement devant ce qui n’est pas évident.');
    s.updateConcept(raison.id, {
      senses: [
        { id: 'sr1', author: 'Descartes', bookId: epub, definition: 'Le bon sens, naturellement égal en tous les hommes.', highlightIds: [by('Le bon sens').id, by('la puissance').id] },
        { id: 'sr2', author: 'Kant', bookId: null, definition: 'Faculté des principes, qui cherche l’inconditionné.', highlightIds: [] },
      ],
      links: [{ conceptId: doute.id, kind: 'distingue', note: 'Le doute est un usage méthodique de la raison.' }],
    });
    s.updateConcept(doute.id, {
      senses: [{ id: 'sd1', author: 'Descartes', bookId: epub, definition: 'Doute méthodique et hyperbolique, préalable à toute certitude.', highlightIds: [by('On objectera').id] }],
      links: [{ conceptId: raison.id, kind: 'proche', note: '' }],
    });
    s.toggleHighlightConcept(by('la puissance').id, raison.id);

    // Carte d'argument : 5 nœuds, 4 liens (dont co-prémisses)
    const nodes = [
      { id: 'n1', highlightId: by('je pense').id, text: '', x: 380, y: 40 },
      { id: 'n2', highlightId: by('ce n’est pas').id, text: '', x: 60, y: 260 },
      { id: 'n3', highlightId: by('On objectera').id, text: '', x: 700, y: 260 },
      { id: 'n4', highlightId: null, text: 'Le doute est encore une pensée.', x: 380, y: 300 },
      { id: 'n5', highlightId: by('Je demeurais').id, text: '', x: 60, y: 480 },
    ];
    const edges = [
      { id: 'e1', source: 'n2', target: 'n1', relation: 'soutient', groupId: 'g1' },
      { id: 'e2', source: 'n4', target: 'n1', relation: 'soutient', groupId: 'g1' },
      { id: 'e3', source: 'n3', target: 'n1', relation: 'objecte', groupId: null },
      { id: 'e4', source: 'n5', target: 'n2', relation: 'illustre', groupId: null },
    ];
    s.setMap(epub, { bookId: epub, nodes, edges, viewport: null });

    s.insert('arguments', {
      id: 'arg1', title: 'Le cogito résiste au doute', bookId: epub,
      premises: [
        { id: 'p1', text: 'Je peux douter de tout ce qui n’est pas évident.', highlightId: null, implicit: false },
        { id: 'p2', text: 'Douter, c’est penser.', highlightId: null, implicit: true },
        { id: 'p3', text: 'Pour penser, il faut être.', highlightId: null, implicit: true },
      ],
      conclusion: { id: 'c1', text: 'Je pense, donc je suis.', highlightId: by('je pense').id, implicit: false },
      comment: 'Prémisse 3 contestable : Lichtenberg dirait « ça pense ».', createdAt: now, updatedAt: now,
    });
    s.insert('arguments', {
      id: 'arg2', title: 'La méthode plutôt que le talent', bookId: epub,
      premises: [{ id: 'q1', text: 'Le bon sens est également partagé.', highlightId: by('Le bon sens').id, implicit: false }, { id: 'q2', text: 'Pourtant les opinions divergent.', highlightId: null, implicit: false }],
      conclusion: { id: 'q3', text: 'La diversité vient de la conduite des pensées.', highlightId: null, implicit: false },
      comment: '', createdAt: now - 1000, updatedAt: now - 1000,
    });

    s.insert('plans', {
      id: 'plan1', title: 'Peut-on douter de tout ?', sujet: 'Peut-on douter de tout ?',
      definitions: 'Douter : suspendre son jugement. « Tout » : y compris le doute lui-même.',
      problematique: 'Le doute radical se détruit-il lui-même, ou fonde-t-il une certitude ?', conclusion: '', draftId: null, createdAt: now, updatedAt: now,
      parts: [
        { id: 'pa1', title: 'Le doute comme méthode', note: 'Tout ce qui n’est pas évident peut être mis en doute.', items: [{ id: 'i1', ref: { kind: 'highlight', id: by('ce n’est pas').id } }, { id: 'i2', ref: { kind: 'concept', id: doute.id } }], children: [
          { id: 'pa1a', title: 'Les sens trompent', note: '', items: [], children: [] },
          { id: 'pa1b', title: 'L’hypothèse du rêve', note: '', items: [{ id: 'i3', ref: { kind: 'text', text: 'Exemple du poêle : la solitude propice à la méditation.' } }], children: [] },
        ] },
        { id: 'pa2', title: 'Le doute rencontre sa limite', note: 'Le doute suppose un sujet qui doute.', items: [{ id: 'i4', ref: { kind: 'argument', id: 'arg1' } }, { id: 'i5', ref: { kind: 'highlight', id: by('je pense').id } }], children: [] },
        { id: 'pa3', title: 'Un doute qui présuppose un langage', note: '', items: [{ id: 'i6', ref: { kind: 'highlight', id: by('On objectera').id } }], children: [] },
      ],
    });

    const card = (id, kind, front, back, highlightId, conceptId, bookId) => ({
      id, kind, front, back, highlightId, conceptId, bookId, suspended: false, createdAt: now,
      fsrs: { due: now - 1000, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
    });
    s.insert('cards', card('k1', 'these', 'Quelle est la thèse de Descartes dans la quatrième partie ?', 'Je pense, donc je suis : première certitude, que le doute ne peut ébranler.', by('je pense').id, null, epub));
    s.insert('cards', card('k2', 'definition', 'Définir « raison » (selon Descartes)', 'Le bon sens, naturellement égal en tous les hommes.', null, raison.id, epub));
    s.insert('cards', card('k3', 'citation', 'Compléter : « Le bon sens est la chose du monde … »', '« … la mieux partagée. »', by('Le bon sens').id, null, epub));
    s.insert('cards', card('k4', 'libre', 'Pourquoi un ouvrage fait par un seul maître est-il plus parfait ?', 'Unité du dessein : un seul auteur suit une même raison.', null, null, epub));

    // Espaces avec groupes
    const w1 = s.createWorkspace('Dissertation : le doute');
    const g1 = s.createGroup(w1.id, null, 'Sources');
    const g1a = s.createGroup(w1.id, g1.id, 'Textes primaires');
    const g2 = s.createGroup(w1.id, null, 'Travail');
    s.addToWorkspace(w1.id, g1a.id, 'book', epub);
    s.addToWorkspace(w1.id, g1a.id, 'book', pdf);
    s.addToWorkspace(w1.id, g2.id, 'plan', 'plan1');
    s.addToWorkspace(w1.id, g2.id, 'argument', 'arg1');
    s.addToWorkspace(w1.id, g2.id, 'map', epub);
    const w2 = s.createWorkspace('Explication : cogito');
    const h1 = s.createGroup(w2.id, null, 'Texte');
    s.createGroup(w2.id, null, 'Brouillons');
    s.addToWorkspace(w2.id, h1.id, 'book', epub);
    s.addToWorkspace(w2.id, h1.id, 'study', s.studies.find((x) => x.bookId === epub).id);
    s.updateSettings({ activeWorkspaceId: null });
  }, ids);

  ids.draft = await st(page, async () => {
    const m = await import('/src/features/editor/api.ts');
    const d = await m.createDraft({
      title: 'Peut-on douter de tout ?', template: 'dissertation',
      html: '<h1>Introduction</h1><p>Douter, c’est suspendre son jugement. Mais un doute qui porterait sur tout se porterait aussi sur lui-même.</p><h2>I. Le doute comme méthode</h2><p>Descartes écrit : « Le bon sens est la chose du monde la mieux partagée ». Ce n’est donc pas l’intelligence qui manque, mais la méthode.</p><h2>II. La limite du doute</h2><p>Le doute rencontre une certitude : je pense, donc je suis.</p>',
    });
    const s = window.__store.getState();
    const w = s.workspaces.find((x) => x.name.startsWith('Dissertation'));
    const g = s.groups.find((x) => x.workspaceId === w.id && x.name === 'Travail');
    s.addToWorkspace(w.id, g.id, 'draft', d.id);
    return d.id;
  });
  ids.ws1 = await st(page, () => window.__store.getState().workspaces[0].id);
  // Programme de terminale chargé depuis la vue Concepts (menu « Plus d’actions »)
  await st(page, () => window.__store.getState().navigate({ name: 'concepts', conceptId: null }));
  await tick(page, 500);
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('button', { name: 'Charger le programme de terminale' }).click();
  await tick(page, 400);
  // Dernière lecture réaliste
  await st(page, (b) => window.__store.getState().updateBook(b, { lastOpenedAt: Date.now() - 600e3 }), ids.epub);
  ids.raison = await st(page, () => window.__store.getState().concepts.find((c) => c.name === 'Raison').id);
  await tick(page, 600);
  return ids;
}


/** Mesures DOM : titres, topbar, boutons sans nom, contrastes insuffisants. */
async function probe(page, ids) {
  const routes = [
    ['home', { name: 'home' }], ['library', { name: 'library' }], ['workspace', { name: 'workspace', workspaceId: ids.ws1, groupId: null }],
    ['concepts', { name: 'concepts', conceptId: ids.raison }], ['extracts', { name: 'extracts' }], ['arguments', { name: 'arguments', argumentId: 'arg1' }],
    ['plans', { name: 'plans', planId: null }], ['plan', { name: 'plans', planId: 'plan1' }], ['revision', { name: 'revision' }], ['write', { name: 'write', draftId: null }],
    ['reader', { name: 'reader', bookId: ids.epub, tab: 'lecture', splitBookId: null }], ['carte', { name: 'reader', bookId: ids.epub, tab: 'carte', splitBookId: null }],
  ];
  const out = {};
  for (const theme of themes) {
    await st(page, (t) => window.__store.getState().updateSettings({ theme: t }), theme);
    for (const [k, r] of routes) {
      await st(page, (r) => window.__store.getState().navigate(r), r);
      await tick(page, k === 'reader' || k === 'carte' ? 2200 : 900);
      out[theme + ':' + k] = await page.evaluate(() => {
        const parse = (c) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
          const n = c.match(/color\(srgb ([^)]+)\)/);
          if (n) { const p = n[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
          return null;
        };
        const L = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const bgOf = (el) => {
          const stack = [];
          for (let e = el; e; e = e.parentElement) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
          }
          let base = [255, 255, 255];
          for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; base = [0, 1, 2].map((j) => c[j] * c[3] + base[j] * (1 - c[3])); }
          return base;
        };
        const fails = {};
        const walker = document.createTreeWalker(document.querySelector('.main') || document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (!n.data.trim()) continue;
          const el = n.parentElement;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
          if (el.closest('.html-doc, .pdf-page, .ProseMirror, .superdoc, [aria-hidden="true"]')) continue;
          const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el);
          const fgb = [0, 1, 2].map((j) => fg[j] * fg[3] + bg[j] * (1 - fg[3]));
          const ratioV = ratio(fgb, bg);
          const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
          const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
          if (ratioV < need) {
            const key = (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase()) + ` ${size}px`;
            if (!fails[key]) fails[key] = { ratio: +ratioV.toFixed(2), text: n.data.trim().slice(0, 30), count: 0 };
            fails[key].count++;
          }
        }
        const title = document.querySelector('.main .page-title, .main h1');
        const tr = title?.getBoundingClientRect();
        const unnamed = [...document.querySelectorAll('button, [role="button"], a, input, select, textarea')]
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width && !(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim() || b.getAttribute('placeholder') || (b.id && document.querySelector(`label[for="${b.id}"]`)) || b.closest('label')); })
          .map((b) => b.outerHTML.slice(0, 90));
        const topbar = document.querySelector('.main .topbar, .reader-topbar');
        const tbBtns = topbar ? [...topbar.querySelectorAll('.btn')].map((b) => `${b.textContent.trim().slice(0, 18)}:${Math.round(b.getBoundingClientRect().height)}`) : [];
        return {
          title: title ? { text: title.textContent || title.value, x: Math.round(tr.left), y: Math.round(tr.top), fs: getComputedStyle(title).fontSize } : null,
          topbar: topbar ? topbar.innerText.replace(/\s+/g, ' ').slice(0, 80) : null,
          tbBtns, unnamed: unnamed.slice(0, 6), fails,
        };
      });
    }
  }
  fs.writeFileSync(path.resolve(ROOT, outDir, 'probe.json'), JSON.stringify(out, null, 1));
  console.log('probe ->', path.join(outDir, 'probe.json'));
}


/** Parcours complémentaires (clair, 1440) : panneau vide, envoi du plan, export, révision complète. */
async function journeys(page, ids, theme = 'light') {
  const tag = `1440-${theme}`;
  await page.setViewportSize(SIZES[1440]);
  await st(page, (t) => window.__store.getState().updateSettings({ theme: t, rightPanel: 'extraits', showExtracts: true }), theme);
  // Extraits → « Aller à l'extrait » → lecteur → retour : on revient aux Extraits
  await st(page, () => window.__store.getState().navigate({ name: 'extracts' }));
  await tick(page, 700);
  await page.locator('.ax-main').first().click();
  await page.waitForSelector('.reader-back', { timeout: 20000 });
  await tick(page, 1800);
  const backLabel = (await page.locator('.reader-back').innerText()).trim();
  await clean(page);
  await snap(page, `parcours-retour-lecteur-${tag}`);
  await page.locator('.reader-back').click();
  await tick(page, 500);
  const backRoute = await st(page, () => window.__store.getState().route.name);
  console.log(`retour du lecteur : bouton « ${backLabel} » → vue ${backRoute}`, backLabel === 'Extraits' && backRoute === 'extracts' ? 'OK' : 'ÉCHEC');
  // Lecteur d'un document sans extrait (DOCX)
  await st(page, (b) => window.__store.getState().openBook(b), ids.docx);
  await page.waitForSelector('.html-doc', { timeout: 20000 });
  await tick(page, 1500);
  await clean(page);
  await snap(page, `parcours-docx-sans-extrait-${tag}`);
  // Plan → éditeur
  await st(page, () => window.__store.getState().navigate({ name: 'plans', planId: 'plan1' }));
  await tick(page, 800);
  await page.getByRole('button', { name: /nvoyer vers l’éditeur/ }).first().click();
  await tick(page, 2500);
  await clean(page);
  await snap(page, `parcours-plan-envoye-${tag}`);
  // Éditeur : menu d'export
  await st(page, (d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.draft);
  await page.waitForSelector('.ProseMirror, .superdoc', { timeout: 25000 }).catch(() => {});
  await tick(page, 2500);
  await page.getByRole('button', { name: /Exporter/ }).first().click();
  await tick(page, 500);
  await snap(page, `parcours-export-${tag}`);
  await page.keyboard.press('Escape');
  // Révision : générateur, liste, session complète
  await st(page, () => window.__store.getState().navigate({ name: 'revision' }));
  await tick(page, 700);
  await page.getByRole('tab', { name: /Créer des cartes/ }).click();
  await tick(page, 700);
  await clean(page);
  await snap(page, `parcours-revision-creer-${tag}`);
  await page.getByRole('tab', { name: /Toutes les cartes/ }).click();
  await tick(page, 700);
  await clean(page);
  await snap(page, `parcours-revision-liste-${tag}`);
  await page.getByRole('tab', { name: /Aujourd’hui/ }).click();
  await tick(page, 500);
  const start = page.locator('.rev-start');
  if (await start.count()) {
    await start.click();
    await tick(page, 600);
    for (let i = 0; i < 12; i++) {
      if (await page.locator('.rev-finish').count()) break;
      await page.keyboard.press('Space');
      await tick(page, 300);
      await page.keyboard.press('4');
      await tick(page, 450);
    }
    await tick(page, 600);
    await clean(page);
    await snap(page, `parcours-revision-fin-${tag}`);
    await page.keyboard.press('Escape');
  }
}

const want = (k) => !only.length || only.includes(k);

async function captureAll(page, ids, theme, sizeKey) {
  const tag = `${sizeKey}-${theme}`;
  await page.setViewportSize(SIZES[sizeKey]);
  await st(page, (t) => window.__store.getState().updateSettings({ theme: t, rightPanel: 'extraits', showExtracts: true, showToc: true }), theme);
  const nav = async (route, ms = 900) => {
    await st(page, (r) => window.__store.getState().navigate(r), route);
    await tick(page, ms);
    await clean(page);
  };
  if (want('home')) { await nav({ name: 'home' }); await snap(page, `home-${tag}`); }
  if (want('library')) { await nav({ name: 'library' }); await snap(page, `library-${tag}`); }
  if (want('workspace')) { await nav({ name: 'workspace', workspaceId: ids.ws1, groupId: null }); await snap(page, `workspace-${tag}`); }
  if (want('concepts')) {
    await nav({ name: 'concepts', conceptId: null }); await snap(page, `concepts-${tag}`);
    await nav({ name: 'concepts', conceptId: ids.raison }); await snap(page, `concept-fiche-${tag}`);
  }
  if (want('extracts')) { await nav({ name: 'extracts' }); await snap(page, `extracts-${tag}`); }
  if (want('arguments')) {
    await nav({ name: 'arguments', argumentId: null }); await snap(page, `arguments-${tag}`);
    await nav({ name: 'arguments', argumentId: 'arg1' }); await snap(page, `argument-${tag}`);
  }
  if (want('plans')) {
    await nav({ name: 'plans', planId: null }); await snap(page, `plans-${tag}`);
    await nav({ name: 'plans', planId: 'plan1' }); await snap(page, `plan-${tag}`);
  }
  if (want('revision')) {
    await nav({ name: 'revision' }); await snap(page, `revision-${tag}`);
    const start = page.locator('.rev-start');
    if (await start.count()) {
      await start.click();
      await tick(page, 700);
      await clean(page);
      await snap(page, `revision-session-${tag}`);
      await page.keyboard.press('Space');
      await tick(page, 600);
      await clean(page);
      await snap(page, `revision-reponse-${tag}`);
      await page.keyboard.press('Escape');
      await tick(page, 300);
    }
  }
  if (want('write')) {
    await nav({ name: 'write', draftId: null }); await snap(page, `ecrits-${tag}`);
    await nav({ name: 'write', draftId: ids.draft }, 300);
    await snap(page, `editeur-chargement-${tag}`);
    await page.waitForSelector('.ProseMirror, .superdoc', { timeout: 25000 }).catch(() => {});
    await tick(page, 2500);
    await clean(page);
    await snap(page, `editeur-${tag}`);
  }
  if (want('reader')) {
    await st(page, (r) => window.__store.getState().navigate(r), { name: 'reader', bookId: ids.epub, tab: 'lecture', splitBookId: null });
    await tick(page, 120);
    await snap(page, `lecteur-chargement-${tag}`);
    await page.waitForSelector('.html-doc', { timeout: 20000 });
    await tick(page, 1400);
    await page.evaluate(() => document.querySelector('[data-hl-id]')?.scrollIntoView({ block: 'center' }));
    await tick(page, 400);
    await clean(page);
    await snap(page, `lecteur-epub-${tag}`);
    // popover d'extrait
    const hl = page.locator('.reader-page[data-pane="a"] [data-hl-id]').nth(2);
    await hl.scrollIntoViewIfNeeded();
    await hl.click();
    await tick(page, 500);
    await page.mouse.move(2, 400);
    await snap(page, `popover-${tag}`);
    await page.keyboard.press('Escape');
    await tick(page, 200);
    // barre de sélection
    await dragSelect(page, 'Je ne sais si je dois vous entretenir des premières méditations');
    await page.mouse.move(2, 400);
    await snap(page, `selection-${tag}`);
    await page.keyboard.press('Escape');
    await st(page, () => getSelection().removeAllRanges());
    // fiche-texte
    await st(page, () => window.__store.getState().updateSettings({ rightPanel: 'etude' }));
    await tick(page, 600);
    await clean(page);
    await snap(page, `fiche-texte-${tag}`);
    await st(page, () => window.__store.getState().updateSettings({ rightPanel: 'extraits' }));
    // carte
    await st(page, (b) => window.__store.getState().navigate({ name: 'reader', bookId: b, tab: 'carte', splitBookId: null }), ids.epub);
    await tick(page, 1500);
    await clean(page);
    await snap(page, `carte-${tag}`);
    // PDF
    await st(page, (b) => window.__store.getState().openBook(b), ids.pdf);
    await page.waitForSelector('.pdf-page', { timeout: 20000 });
    await tick(page, 2200);
    await clean(page);
    await snap(page, `lecteur-pdf-${tag}`);
    // côte à côte
    await st(page, ({ a, b }) => window.__store.getState().openBook(a, b), { a: ids.epub, b: ids.pdf });
    await tick(page, 3000);
    await clean(page);
    await snap(page, `cote-a-cote-${tag}`);
  }
  if (want('palette')) {
    await nav({ name: 'home' }, 600);
    await page.keyboard.press('Control+k');
    await tick(page, 400);
    await snap(page, `palette-${tag}`);
    await page.keyboard.type('doute');
    await tick(page, 400);
    await snap(page, `palette-requete-${tag}`);
    await page.keyboard.press('Escape');
    await tick(page, 200);
  }
}

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-crit-5290', server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: SIZES[1440], colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await st(page, () => window.__store.getState().updateSettings({ theme: 'light' }));
  if (want('vide')) {
    for (const r of [{ name: 'home' }, { name: 'library' }, { name: 'extracts' }, { name: 'concepts', conceptId: null }, { name: 'arguments', argumentId: null }, { name: 'plans', planId: null }, { name: 'revision' }, { name: 'write', draftId: null }]) {
      await st(page, (r) => window.__store.getState().navigate(r), r);
      await tick(page, 700);
      await clean(page);
      await snap(page, `vide-${r.name}`);
    }
  }
  const ids = await seed(page);
  if (process.argv.includes('--journeys')) { for (const th of themes) await journeys(page, ids, th); }
  else if (process.argv.includes('--probe')) { await page.setViewportSize(SIZES[1440]); await probe(page, ids); }
  else for (const sz of sizes) for (const th of themes) await captureAll(page, ids, th, sz);
} finally {
  const uniq = [...new Set(errors)].filter((e) => !/404|favicon/.test(e));
  console.log('ERREURS NAVIGATEUR :', uniq.length);
  uniq.slice(0, 20).forEach((e) => console.log('  ', e.slice(0, 300)));
  await browser.close();
  await server.close();
}
