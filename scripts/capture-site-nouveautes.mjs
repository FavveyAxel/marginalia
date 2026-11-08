// Captures du site pour les nouveautés 3.46 → 3.51 : plan rattaché à l'écrit (Fiches, Tableau),
// page d'une vidéo (transcription, extraits minutés), liège des cartes avec cartes-documents.
// Données de démonstration uniquement (dissertation inventée sur la liberté, vidéo inventée, aucune
// vraie vidéo : l'image du lecteur est scripts/site-video-frame.html).
// Sortie : site/public/captures/{plan-fiches,plan-tableau,video,liege}.png
// Lancer : timeout 300 node scripts/capture-site-nouveautes.mjs
import path from 'node:path';
import { withApp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = (n) => path.join(ROOT, 'site/public/captures', n);
const tick = (page, ms = 400) => page.waitForTimeout(ms);

await withApp(5391, async (page) => {
  console.log('app prête');
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', theme: 'light', appStyle: 'normal', videoOnline: true }));

  // ── Données : un écrit et son plan, une vidéo, un livre ──
  await page.evaluate(async () => {
    const { host } = await import('/src/lib/platform.ts');
    // miniature de la vidéo : peinte ici, comme l'image du lecteur
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, '#2f4a5c');
    grad.addColorStop(0.5, '#3d5f6e');
    grad.addColorStop(1, '#b9853a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#23362f';
    g.fillRect(45, 50, 300, 210);
    g.strokeStyle = '#6b4a2e';
    g.lineWidth = 10;
    g.strokeRect(45, 50, 300, 210);
    g.fillStyle = 'rgba(245,240,225,.9)';
    g.font = 'italic 34px Georgia';
    g.fillText('Être libre ?', 75, 110);
    const thumb = c.toDataURL('image/jpeg', 0.85);
    window.__mgVideoEmbed = () => '/scripts/site-video-frame.html';

    const now = Date.now();
    const lines = [
      [0, 'On croit souvent que la liberté se mesure au nombre de choix possibles.'],
      [8000, 'Plus il y a de portes ouvertes, plus on serait libre.'],
      [14000, 'Mais un choix immense peut aussi paralyser : on hésite, on remet à demain.'],
      [24000, 'Les philosophes ont posé la question autrement.'],
      [30000, 'Qui choisit nos désirs, sinon notre histoire ?'],
      [38000, 'Si mes envies viennent de mon éducation, suivre mes envies, est-ce encore agir par moi-même ?'],
      [50000, 'Prenons un exemple simple. Quelqu’un qui fume par habitude dit qu’il le veut.'],
      [60000, 'Le veut-il vraiment, ou cède-t-il à une habitude ?'],
      [70000, 'Être libre, ce serait alors pouvoir juger ses propres désirs.'],
    ].map(([s, t], i, a) => ({ s, e: (a[i + 1]?.[0] ?? s + 9000), t }));
    await host.storeFile('vid1', 'transcript.json', new TextEncoder().encode(JSON.stringify({ lang: 'fr', auto: false, lines })));

    const book = (id, title, author, extra = {}) => ({ id, title, author, format: 'epub', fileName: 'book.epub', originalName: 'book.epub', size: 1, addedAt: now - 9e7, lastOpenedAt: now - 3e6, progress: 0.42, position: null, cover: null, edition: { translator: '', place: '', publisher: '', year: '' }, ...extra });
    const s = window.__store.getState();
    const n = (id, title, note, extra = {}, children = []) => ({ id, title, note, items: [], children, ...extra });
    const outline = [
      { level: 1, text: 'Être libre, est-ce n’obéir à personne ?', words: 0 },
      { level: 2, text: 'Introduction', words: 640 },
      { level: 2, text: 'I. L’indépendance : n’obéir qu’à soi', words: 120 },
      { level: 3, text: 'A. Le désir de ne dépendre de personne', words: 980 },
      { level: 3, text: 'B. Les limites de l’indépendance', words: 760 },
      { level: 2, text: 'II. Obéir à la loi qu’on s’est donnée', words: 90 },
      { level: 3, text: 'A. Le contrat social', words: 610 },
      { level: 3, text: 'B. Obéir à sa raison', words: 340 },
      { level: 2, text: 'III. Une liberté à conquérir', words: 40 },
      { level: 3, text: 'A. Se libérer de ses passions', words: 120 },
      { level: 2, text: 'Conclusion', words: 0 },
    ];
    window.__store.setState({
      books: [
        book('bRou', 'Du contrat social', 'Jean-Jacques Rousseau'),
        book('bSpi', 'Éthique', 'Spinoza', { progress: 0.18 }),
        { ...book('vid1', 'La liberté, une histoire', 'Chaîne Agora'), format: 'video', fileName: '', progress: 0.62, cover: thumb, video: { provider: 'youtube', id: 'demo', url: 'https://www.youtube.com/watch?v=demo', duration: 2530, position: 1572, transcript: { lang: 'fr', auto: false }, chapters: [{ s: 0, t: 'Le nombre des choix' }, { s: 24, t: 'Qui choisit nos désirs ?' }, { s: 50, t: 'L’exemple de l’habitude' }] } },
      ],
      drafts: [{ id: 'd1', title: 'Dissertation : être libre, est-ce n’obéir à personne ?', fileName: 'd1.docx', externalPath: null, wordCount: 3700, template: null, createdAt: now - 8e7, updatedAt: now - 2e6, outline }],
      plans: [
        {
          id: 'p1',
          title: 'Être libre, est-ce n’obéir à personne ?',
          sujet: 'Être libre, est-ce n’obéir à personne ?',
          definitions: 'Liberté : pouvoir d’agir selon sa volonté. Obéir : se soumettre à une règle venue d’autrui.',
          problematique: 'La liberté exclut-elle toute obéissance, ou l’obéissance à certaines lois en est-elle la condition ?',
          parts: [
            n('a', 'L’indépendance : n’obéir qu’à soi', 'L’opinion commune : être libre, c’est ne dépendre de personne.', { status: 'review' }, [
              n('a1', 'Le désir de ne dépendre de personne', 'L’enfant qui refuse toute règle.', { status: 'done', goal: 1000 }),
              n('a2', 'Les limites de l’indépendance', 'Seul, je reste esclave de mes besoins.', { status: 'review', goal: 900 }),
            ]),
            n('b', 'Obéir à la loi qu’on s’est donnée', 'L’obéissance à la loi n’est pas servitude si j’en suis l’auteur.', { status: 'draft' }, [
              n('b1', 'Le contrat social', '« L’obéissance à la loi qu’on s’est prescrite est liberté. »', { status: 'draft', goal: 1000 }),
              n('b2', 'Obéir à sa raison', 'Agir par raison, c’est agir par soi-même.', { status: 'draft', goal: 900 }),
              n('b3', 'Objection : la loi reste une contrainte', 'Répondre sans esquiver.', { goal: 600 }),
            ]),
            n('c', 'Une liberté à conquérir', 'La liberté se gagne contre soi.', {}, [n('c1', 'Se libérer de ses passions', 'Comprendre ce qui nous détermine.', { goal: 900 })]),
          ],
          conclusion: 'Être libre n’est pas n’obéir à personne, mais n’obéir qu’à des lois que la raison reconnaît.',
          introProgress: { status: 'done', goal: 700 },
          conclusionProgress: { goal: 600 },
          draftId: 'd1',
          createdAt: now - 9e7,
          updatedAt: now - 2e6,
        },
      ],
      highlights: [
        { id: 'h1', bookId: 'vid1', text: 'Mais un choix immense peut aussi paralyser : on hésite, on remet à demain.', note: '', category: 'objection', anchor: { kind: 'html', chapter: 0, start: 14000, end: 24000 }, locationLabel: '0:14', conceptIds: [], createdAt: now - 4e6, updatedAt: now - 4e6 },
        { id: 'h2', bookId: 'vid1', text: 'Qui choisit nos désirs, sinon notre histoire ?', note: 'Lien avec Spinoza : l’illusion du libre arbitre.', category: 'probleme', anchor: { kind: 'html', chapter: 0, start: 30000, end: 38000 }, locationLabel: '0:30', conceptIds: [], createdAt: now - 3e6, updatedAt: now - 3e6 },
        { id: 'h3', bookId: 'vid1', text: 'Être libre, ce serait alors pouvoir juger ses propres désirs.', note: '', category: 'these', anchor: { kind: 'html', chapter: 0, start: 70000, end: 79000 }, locationLabel: '1:10', conceptIds: [], createdAt: now - 2e6, updatedAt: now - 2e6 },
      ],
    });
    void s;
  });

  console.log('données posées');
  // ── 1. Plan rattaché : Fiches et Tableau ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'plans', planId: 'p1', view: 'fiches' }));
  await page.waitForSelector('[data-testid="plan-fiches"]');
  await page.mouse.move(5, 5);
  await tick(page, 700);
  await page.screenshot({ path: OUT('plan-fiches.png') });
  await page.click('[data-testid="plan-view-tableau"]');
  await page.waitForSelector('[data-testid="plan-tableau"]');
  await page.mouse.move(5, 5);
  await tick(page, 600);
  await page.screenshot({ path: OUT('plan-tableau.png') });
  await page.click('[data-testid="plan-view-plan"]');

  // ── 2. Page d'une vidéo ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'reader', bookId: 'vid1', tab: 'lecture', splitBookId: null }));
  await page.waitForSelector('.vv-line', { timeout: 20000 });
  await tick(page, 1200);
  await page.evaluate(() => {
    document.querySelectorAll('.toast, .toasts > *').forEach((t) => t.remove());
    document.activeElement?.blur?.();
  });
  await page.mouse.move(640, 300);
  await tick(page, 900);
  await page.evaluate(() => document.querySelectorAll('[role="tooltip"], .tooltip, .tip').forEach((t) => t.remove()));
  await page.screenshot({ path: OUT('video.png') });

  // ── 3. Liège : cartes épinglées et cartes-documents (style Skeuomorphisme) ──
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.updateSettings({ appStyle: 'skeuo' });
    const idea = (id, text, x, y, extra = {}) => ({ id, highlightId: null, text, x, y, ...extra });
    const doc = (id, kind, ref, title, x, y) => ({ id, highlightId: null, text: title, x, y, doc: { kind, id: ref } });
    const e = (id, a, b, relation) => ({ id, source: a, target: b, relation, groupId: null });
    window.__store.setState({
      maps: {
        ...s.maps,
        m1: {
          kind: 'board',
          title: 'Être libre, est-ce n’obéir à personne ?',
          bookIds: [],
          nodes: [
            idea('c', 'Être libre, est-ce n’obéir à personne ?', 520, 40, { kind: 'question' }),
            idea('i1', 'L’indépendance totale est une illusion : nos besoins nous lient aux autres.', 120, 250),
            idea('i2', 'Obéir à la loi qu’on s’est donnée, est-ce encore obéir ?', 860, 250),
            doc('dd', 'draft', 'd1', 'Dissertation', 40, 470),
            doc('dp', 'plan', 'p1', 'Plan', 360, 520),
            doc('db', 'book', 'bRou', 'Du contrat social', 700, 500),
            doc('dv', 'book', 'vid1', 'La liberté, une histoire', 1020, 470),
          ],
          edges: [e('e1', 'i1', 'c', 'supports'), e('e2', 'i2', 'c', 'objects'), e('e3', 'db', 'i2', 'supports'), e('e4', 'dv', 'i2', 'illustrates'), e('e5', 'dd', 'i1', 'refines')],
          viewport: null,
        },
      },
    });
    s.navigate({ name: 'board', boardId: 'm1' });
  });
  await page.waitForSelector('[data-testid="doc-node"]');
  await tick(page, 600);
  await page.evaluate(() => document.querySelector('.react-flow__controls-fitview')?.click());
  await tick(page, 900);
  // mini-carte fermée, et son bouton retiré de la capture
  if (await page.locator('.map-minimap').count()) await page.click('[data-act="minimap"]');
  await page.evaluate(() => document.querySelectorAll('.toast, .toasts > *, [data-act="minimap"]').forEach((t) => t.remove()));
  await page.mouse.move(5, 5);
  await page.screenshot({ path: OUT('liege.png') });
  console.log('captures : plan-fiches, plan-tableau, video, liege');
});
