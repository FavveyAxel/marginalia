// Vidéos, de bout en bout dans le navigateur (Vite + Chromium ; jamais le vrai réseau : la plateforme est
// simulée par un faux `host.video`, le lecteur par scripts/fake-video-player.html, qui parle le protocole
// du lecteur YouTube intégré) :
//  1. Bibliothèque › « Vidéo » : lien reconnu (youtu.be, minute de départ), titre, chaîne, durée et
//     miniature récupérés, transcription demandée ; la vidéo est ajoutée, sa transcription rangée avec elle ;
//  2. style Normal : miniature, barre d'avancement, « 2 min sur 10 min » ; filtre « Vidéos » ;
//  3. page de la vidéo : lecteur intégré qui répond (minute en cours), transcription synchronisée,
//     recherche dans la transcription, « Noter ce moment » (minute figée), sélection dans la transcription →
//     extrait avec catégorie et minutage, clic sur un minutage → le lecteur y va ; position retenue ;
//  4. arrivée par un extrait (Extraits, recherche) : le lecteur va au moment de l'extrait ; citation ;
//  5. style Skeuomorphisme : pile de boîtiers sur l'étagère ; clic → la cassette sort ; « Regarder » ;
//  6. simple lien (plateforme à abonnement) : titre à la main, pas de lecteur, minutage tapé ;
//  7. réglage « Vidéos en ligne » désactivé : aucun lecteur chargé, aucun appel à la plateforme ;
//  8. partage : la vidéo voyage sans fichier (ni transcription), reconnue à la réception ; corbeille.
// Lancer : timeout 300 node scripts/test-videos.mjs        Captures : shots/videos/
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { withApp, shot } from './harness.mjs';

const PORT = 5232;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
  passed++;
  console.log('  ok', name);
};

// Transcription inventée pour le test (sous-titres simulés).
const CUES = [
  'On croit souvent que la liberté',
  'se mesure au nombre de choix possibles.',
  'Plus il y a de portes ouvertes, plus on serait libre.',
  'Mais un choix immense peut aussi paralyser :',
  'on hésite, on remet à demain.',
  'Les philosophes ont posé la question autrement.',
  'Qui choisit nos désirs, sinon notre histoire ?',
  'Si mes envies viennent de mon éducation,',
  'suivre mes envies, est-ce encore agir par moi-même ?',
  'Prenons un exemple simple.',
  'Quelqu’un qui fume par habitude dit qu’il le veut.',
  'Le veut-il vraiment, ou cède-t-il à une habitude ?',
].map((t, i) => ({ s: i * 4000, d: 3800, t }));

const SETUP = (cues) => {
  window.__videoCalls = [];
  window.__mgVideoEmbed = (provider, id, start) => `/scripts/fake-video-player.html?provider=${provider}&id=${id}&start=${Math.floor(start)}&duration=600`;
  window.__u8tob64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__b64tou8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  return import('/src/lib/platform.ts').then(({ host }) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, '#3a6b8f');
    grad.addColorStop(1, '#d9a21b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 640, 360);
    const thumb = c.toDataURL('image/jpeg', 0.8);
    host.video = {
      setOnline: async (on) => on,
      meta: async (provider, id) => {
        window.__videoCalls.push(['meta', provider, id]);
        return { ok: true, title: 'La liberté, une histoire', author: 'Chaîne Agora', duration: 0, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
      },
      thumb: async (url) => {
        window.__videoCalls.push(['thumb', url]);
        return thumb;
      },
      transcript: async (provider, id, lang) => {
        window.__videoCalls.push(['transcript', provider, id, lang]);
        return { ok: true, lang: 'fr', auto: true, cues, duration: 600, chapters: [{ s: 0, t: 'Le nombre des choix' }, { s: 20, t: 'Qui choisit nos désirs ?' }, { s: 36, t: 'L’exemple de l’habitude' }] };
      },
    };
  });
};

const frameState = (page) => page.evaluate(() => {
  const f = document.querySelector('[data-testid="video-frame"]');
  const w = f && f.contentWindow;
  return w ? { received: (w.__received || []).map((d) => d.func || d.event), lastSeek: [...(w.__received || [])].reverse().find((d) => d.func === 'seekTo')?.args?.[0] ?? null } : null;
});

await withApp(PORT, async (page, errors) => {
  const S = (fn, a) => page.evaluate(fn, a);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready);
  await S(SETUP, CUES);
  await S(() => {
    window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', appStyle: 'normal' });
    window.__store.getState().navigate({ name: 'library' });
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

  // ── 1. Ajouter une vidéo ──
  await page.getByTestId('video-add').click();
  await page.waitForSelector('[data-testid="video-menu"]');
  await page.fill('[data-testid="video-link"]', 'https://youtu.be/AbCdEfGhIjK?t=90');
  await page.waitForFunction(() => document.querySelector('[data-testid="video-title"]')?.value === 'La liberté, une histoire');
  ok('lien reconnu : titre et chaîne remplis', (await page.inputValue('[data-testid="video-author"]')) === 'Chaîne Agora');
  ok('miniature affichée dans l’aperçu', (await page.locator('.va-thumb img').count()) === 1);
  ok('transcription proposée (cochée)', await page.isChecked('[data-testid="video-with-transcript"]'));
  await shot(page, 'shots/videos/01-ajout.png');
  await page.getByTestId('video-add-confirm').click();
  await page.waitForFunction(() => window.__store.getState().books.some((b) => b.format === 'video' && b.video?.transcript));
  const vb = await S(() => window.__store.getState().books.find((b) => b.format === 'video'));
  ok('vidéo ajoutée (YouTube, identifiant, lien, position de départ)', vb.video.provider === 'youtube' && vb.video.id === 'AbCdEfGhIjK' && vb.video.url === 'https://www.youtube.com/watch?v=AbCdEfGhIjK' && vb.video.position === 90, vb.video);
  ok('sans fichier ; chaîne en auteur ; plateforme en éditeur', vb.fileName === '' && vb.size === 0 && vb.author === 'Chaîne Agora' && vb.edition.publisher === 'YouTube');
  ok('miniature réduite en 16:9 et rangée avec la vidéo', typeof vb.cover === 'string' && vb.cover.startsWith('data:image/jpeg'));
  ok('transcription : sous-titres demandés en français, durée notée', vb.video.transcript.lang === 'fr' && vb.video.transcript.auto === true && vb.video.duration === 600);
  const stored = await S(async (id) => {
    const { host } = await import('/src/lib/platform.ts');
    return JSON.parse(new TextDecoder().decode(await host.readFile(id, 'transcript.json')));
  }, vb.id);
  ok('transcription rangée avec la vidéo (lignes regroupées en phrases)', Array.isArray(stored.lines) && stored.lines.length >= 4 && stored.lines.length < CUES.length && stored.lines[0].s === 0, stored.lines.length);
  await page.getByTestId('video-add').click();
  await page.fill('[data-testid="video-link"]', 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
  await page.waitForSelector('.va-pop >> text=Déjà dans la bibliothèque');
  ok('même vidéo : « Déjà dans la bibliothèque », ajout impossible', await page.getByTestId('video-add-confirm').isDisabled());
  await page.keyboard.press('Escape');

  // ── 2. Bibliothèque, style Normal ──
  await page.waitForSelector('[data-testid="lib-video"]');
  const card = await S(() => {
    const c = document.querySelector('[data-testid="lib-video"]');
    return { img: !!c.querySelector('[data-testid="video-thumb"] img'), pct: c.querySelector('[data-testid="video-progress"]').getAttribute('aria-valuenow'), at: c.querySelector('[data-testid="lib-video-at"]').textContent, span: getComputedStyle(c).gridColumnStart };
  });
  ok('grille : miniature de la vidéo, deux colonnes', card.img && /span 2/.test(card.span), card);
  ok('barre d’avancement et « 2 min sur 10 min »', card.pct === '15' && card.at === '2 min sur 10 min', card);
  await page.locator('.chip', { hasText: 'Vidéos' }).click();
  ok('filtre « Vidéos »', (await page.locator('[data-testid="lib-video"]').count()) === 1 && (await page.locator('.lib-card:not(.lib-card-video)').count()) === 0);
  await shot(page, 'shots/videos/02-bibliotheque.png');

  // ── 3. Page de la vidéo ──
  await page.locator('[data-testid="lib-video"]').click();
  await page.waitForSelector('[data-testid="video-view"]');
  await page.waitForSelector('[data-testid="video-frame"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="video-now"]')?.textContent === '1:30');
  ok('lecteur intégré : reprise à la position retenue (1:30), il répond', true);
  ok('bouton « Plein écran » sous le lecteur', (await page.getByTestId('video-fullscreen').count()) === 1);
  ok('transcription affichée', (await page.locator('.vv-line').count()) === stored.lines.length);
  ok('ligne en cours mise en avant', (await page.locator('.vv-line.is-now').count()) === 1);
  await page.fill('[data-testid="video-transcript-search"]', 'habitude');
  ok('recherche dans la transcription', (await page.locator('.vv-line').count()) >= 1 && (await page.locator('.vv-line').count()) < stored.lines.length);
  await page.fill('[data-testid="video-transcript-search"]', '');

  // « Noter ce moment » : la minute est figée quand on commence à écrire.
  await page.locator('[data-testid="video-moment-text"]').click();
  const frozen = await page.inputValue('[data-testid="video-moment-time"]');
  await page.fill('[data-testid="video-moment-text"]', 'La liberté ne se réduit pas au nombre de choix.');
  await page.locator('.vv-compose').getByRole('radio', { name: 'Thèse', exact: true }).click();
  await page.getByTestId('video-moment-add').click();
  let hs = await S((id) => window.__store.getState().highlights.filter((h) => h.bookId === id), vb.id);
  ok('« Noter ce moment » : extrait minuté, catégorie', hs.length === 1 && hs[0].locationLabel === frozen && hs[0].category === 'these' && hs[0].anchor.kind === 'html' && hs[0].anchor.start === 90000, { frozen, h: hs[0] });

  // Sélection dans la transcription → extrait.
  const line3 = await S(() => {
    const p = document.querySelectorAll('.vv-line')[2].querySelector('.vv-line-text');
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, p.firstChild.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return p.textContent;
  });
  await page.waitForSelector('[data-testid="video-selpop"]');
  await shot(page, 'shots/videos/03-selection.png');
  await page.locator('[data-testid="video-selpop"] [data-cat="objection"]').click();
  hs = await S((id) => window.__store.getState().highlights.filter((h) => h.bookId === id), vb.id);
  const fromLine = hs.find((h) => h.category === 'objection');
  ok('sélection dans la transcription → extrait (texte, objection, minutage de la ligne)', fromLine && fromLine.text === line3.replace(/\s+/g, ' ').trim() && fromLine.anchor.start === stored.lines[2].s && fromLine.locationLabel === `${Math.floor(stored.lines[2].s / 60000)}:${String(Math.floor((stored.lines[2].s / 1000) % 60)).padStart(2, '0')}`, fromLine);
  ok('la ligne surlignée est marquée dans la transcription', (await page.locator('.vv-line.is-marked').count()) >= 1);
  ok('extraits rangés par minutage', (await page.locator('[data-testid="video-extract"]').count()) === 2);

  // Clic sur un minutage → le lecteur va à ce moment.
  await page.locator('[data-testid="video-extract"]', { hasText: line3.slice(0, 20) }).locator('[data-testid="video-extract-time"]').click();
  await page.waitForFunction((t) => {
    const w = document.querySelector('[data-testid="video-frame"]').contentWindow;
    return [...(w.__received || [])].some((d) => d.func === 'seekTo' && d.args[0] === t);
  }, stored.lines[2].s / 1000);
  ok('clic sur un minutage : le lecteur y va et joue', (await frameState(page)).received.includes('playVideo'));
  await page.waitForTimeout(1600); // le faux lecteur avance
  await shot(page, 'shots/videos/04-page-video.png');
  const citation = await S(async (id) => {
    const { formatCitation } = await import('/src/lib/citation.ts');
    const s = window.__store.getState();
    const h = s.highlights.find((x) => x.bookId === id && x.category === 'these');
    return formatCitation(h, s.books.find((b) => b.id === id));
  }, vb.id);
  ok('citation : chaîne, titre, plateforme, minutage', citation === '« La liberté ne se réduit pas au nombre de choix. » (Chaîne Agora, La liberté, une histoire, YouTube, 1:30).', citation);

  // Position retenue en quittant la page.
  await S(() => window.__store.getState().navigate({ name: 'extracts' }));
  await page.waitForTimeout(300);
  const pos = await S((id) => window.__store.getState().books.find((b) => b.id === id).video.position, vb.id);
  ok('position retenue en quittant la page', pos > stored.lines[2].s / 1000, pos);

  // ── 4. Arrivée par un extrait ──
  await S((id) => {
    const s = window.__store.getState();
    s.jumpToHighlight(s.highlights.find((h) => h.bookId === id && h.category === 'these').id);
  }, vb.id);
  await page.waitForSelector('[data-testid="video-frame"]');
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-testid="video-frame"]')?.contentWindow;
    return w && [...(w.__received || [])].some((d) => d.func === 'seekTo' && d.args[0] === 90);
  });
  ok('arrivée par un extrait : le lecteur va à son minutage', true);
  ok('l’extrait est mis en avant', (await page.locator('.vv-extract.is-active').count()) === 1);

  // ── 4b. Chapitres, signets, vitesse, « Rejouer », recherche dans les transcriptions ──
  const vb2 = await S((id) => window.__store.getState().books.find((b) => b.id === id).video, vb.id);
  ok('chapitres récupérés avec la transcription', vb2.chapters?.length === 3 && vb2.chapters[1].t === 'Qui choisit nos désirs ?', vb2.chapters);
  ok('extraits rangés sous leur chapitre', (await page.locator('[data-testid="video-extract-chapter"]').count()) >= 1);
  await page.getByTestId('video-tab-chapters').click();
  ok('onglet « Sommaire » : les chapitres', (await page.locator('[data-testid="video-chapter"]').count()) === 3);
  await page.locator('[data-testid="video-chapter"]').nth(2).click();
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-testid="video-frame"]').contentWindow;
    return [...(w.__received || [])].some((d) => d.func === 'seekTo' && d.args[0] === 36);
  });
  ok('clic sur un chapitre : le lecteur y va', true);
  await page.waitForFunction(() => /habitude/.test(document.querySelector('[data-testid="video-now-chapter"]')?.textContent || ''));
  ok('chapitre en cours affiché sous le lecteur', true);
  await shot(page, 'shots/videos/09-sommaire.png');

  // Signets : bouton, puis ⌘D ; la liste ; renommer ; y revenir.
  await page.getByTestId('video-bookmark-add').click();
  await page.waitForSelector('[data-testid="video-bookmark"]');
  let bms = await S((id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id), vb.id);
  ok('« Signet » : signet au moment en cours, nommé d’après le chapitre', bms.length === 1 && bms[0].label === 'L’exemple de l’habitude' && /^\d+:\d\d$/.test(bms[0].locationLabel) && bms[0].anchor.kind === 'html', bms[0]);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('ControlOrMeta+d');
  await page.waitForFunction((id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id).length === 2, vb.id);
  ok('⌘D : un second signet', true);
  ok('onglet « Signets » : la liste par minutage', (await page.locator('[data-testid="video-bookmark"]').count()) === 2);
  const label = page.locator('.vv-mark-label').first();
  await label.fill('Le passage à revoir');
  await label.press('Enter');
  bms = await S((id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id), vb.id);
  ok('signet renommé', bms.some((b) => b.label === 'Le passage à revoir'));
  await shot(page, 'shots/videos/10-signets.png');
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await S((id) => {
    const s = window.__store.getState();
    s.jumpToBookmark(s.bookmarks.find((b) => b.bookId === id).id);
  }, vb.id);
  await page.waitForSelector('[data-testid="video-frame"]');
  const bmSec = await S((id) => {
    const b = window.__store.getState().bookmarks.find((x) => x.bookId === id);
    return b.anchor.start / 1000;
  }, vb.id);
  await page.waitForFunction((t) => {
    const w = document.querySelector('[data-testid="video-frame"]')?.contentWindow;
    return w && [...(w.__received || [])].some((d) => d.func === 'seekTo' && d.args[0] === t);
  }, bmSec);
  ok('arrivée par un signet (⌘K, Signets) : le lecteur y va', true);

  // Vitesse de lecture.
  await page.selectOption('[data-testid="video-rate"]', '1.5');
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-testid="video-frame"]').contentWindow;
    return [...(w.__received || [])].some((d) => d.func === 'setPlaybackRate' && d.args[0] === 1.5);
  });
  ok('vitesse de lecture 1,5× transmise au lecteur', true);

  // « Rejouer l'extrait » : du début à la fin, puis pause.
  await page.locator('[data-testid="video-extract"]').first().hover();
  await page.locator('[data-testid="video-extract-replay"]').first().click();
  await page.waitForFunction(() => {
    const w = document.querySelector('[data-testid="video-frame"]').contentWindow;
    const r = w.__received || [];
    const i = r.map((d) => d.func).lastIndexOf('playVideo');
    return i >= 0 && r.slice(i).some((d) => d.func === 'pauseVideo');
  }, null, { timeout: 15000 });
  ok('« Rejouer l’extrait » : lecture du passage, puis pause à sa fin', true);

  // Recherche (⌘K) dans les transcriptions.
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await S(() => window.__store.getState().setCommandOpen(true));
  await page.keyboard.type('remet à demain');
  await page.waitForSelector('text=Transcriptions');
  const tItem = page.locator('[data-idx]', { hasText: 'remet à demain' }).filter({ hasText: /La liberté, une histoire · \d+:\d\d/ }).first();
  ok('⌘K : une phrase trouvée dans la transcription, avec la vidéo et le minutage', (await tItem.count()) === 1, await page.locator('[data-idx]').allTextContents());
  await tItem.click();
  await page.waitForSelector('[data-testid="video-frame"]');
  const lineSec = stored.lines.find((l) => /remet à demain/.test(l.t)).s / 1000;
  await page.waitForFunction((t) => {
    const w = document.querySelector('[data-testid="video-frame"]')?.contentWindow;
    return w && [...(w.__received || [])].some((d) => d.func === 'seekTo' && d.args[0] === t);
  }, lineSec);
  ok('⌘K : la vidéo s’ouvre au moment de la phrase', true);

  // Accueil : la vidéo est le « Dernier document ».
  await S(() => window.__store.getState().navigate({ name: 'home' }));
  await page.waitForSelector('.home-resume-kind');
  ok('accueil : « Dernier document » pour une vidéo', (await page.locator('.home-resume-kind').first().innerText()).includes('Dernier document'));

  // ── 5. Skeuomorphisme : pile de boîtiers ──
  await S(() => {
    window.__store.getState().updateSettings({ appStyle: 'skeuo' });
    window.__store.getState().navigate({ name: 'library' });
  });
  await page.locator('.chip', { hasText: 'Tous' }).click();
  await page.waitForSelector('[data-testid="cassette-edge"]');
  ok('étagère : la vidéo dans sa pile de boîtiers, titre sur la tranche', (await page.locator('[data-testid="cassette-edge"] .vp-title').innerText()) === 'La liberté, une histoire');
  await shot(page, 'shots/videos/05-etagere.png');
  await page.locator('[data-testid="cassette-edge"]').click();
  await page.waitForSelector('.vs-layer.is-out');
  ok('clic : la cassette sort de son boîtier', (await page.locator('[data-testid="cassette-out"] [data-testid="video-cassette"]').count()) === 1);
  await page.waitForTimeout(500);
  await shot(page, 'shots/videos/06-cassette-sortie.png');
  await page.click('[data-act="cassette-back"]');
  await page.waitForSelector('[data-testid="cassette-out"]', { state: 'detached' });
  ok('« Remettre en place » : la cassette rentre dans la pile', (await page.locator('[data-testid="cassette-edge"].is-out').count()) === 0);
  await page.locator('[data-testid="cassette-edge"]').click();
  await page.waitForSelector('.vs-layer.is-out');
  await page.waitForTimeout(300);
  await page.click('[data-act="cassette-open"]');
  await page.waitForSelector('[data-testid="video-frame"]');
  await page.waitForTimeout(700);
  ok('« Regarder » ouvre la vidéo', true);
  await shot(page, 'shots/videos/07-page-skeuo.png');

  // ── 6. Simple lien ──
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await page.getByTestId('video-add').click();
  await page.fill('[data-testid="video-link"]', 'https://www.exemple-plateforme.fr/documentaires/les-lumieres');
  await page.waitForSelector('[data-testid="video-preview"]');
  ok('lien quelconque : titre à remplir à la main', await page.getByTestId('video-add-confirm').isDisabled());
  await page.fill('[data-testid="video-title"]', 'Les Lumières, un documentaire');
  await page.fill('[data-testid="video-author"]', 'Une chaîne de télévision');
  await page.getByTestId('video-add-confirm').click();
  const link = await S(() => window.__store.getState().books.find((b) => b.video?.provider === 'link'));
  ok('lien ajouté (sans identifiant, sans plateforme en éditeur)', link && link.video.id === '' && link.edition.publisher === '' && link.title === 'Les Lumières, un documentaire');
  ok('aucun appel à la plateforme pour un simple lien', !(await S(() => window.__videoCalls.some((c) => c[0] === 'meta' && c[1] === 'link'))));
  await S((id) => window.__store.getState().openBook(id), link.id);
  await page.waitForSelector('[data-testid="video-player-off"]');
  ok('lien : pas de lecteur, « Ouvrir dans le navigateur »', (await page.locator('[data-testid="video-frame"]').count()) === 0);
  ok('lien : transcription non proposée', (await page.locator('[data-testid="video-transcript-fetch"]').count()) === 0);
  await page.fill('[data-testid="video-moment-time"]', '12:05');
  await page.fill('[data-testid="video-moment-text"]', 'Le passage sur la tolérance.');
  await page.getByTestId('video-moment-add').click();
  const lh = await S((id) => window.__store.getState().highlights.find((h) => h.bookId === id), link.id);
  ok('lien : extrait au minutage tapé', lh && lh.locationLabel === '12:05' && lh.anchor.start === 725000, lh);

  // ── 7. Vidéos en ligne désactivées ──
  const before = await S(() => window.__videoCalls.length);
  await S((id) => {
    window.__store.getState().updateSettings({ videoOnline: false, appStyle: 'normal' });
    window.__store.getState().openBook(id);
  }, vb.id);
  await page.waitForSelector('[data-testid="video-player-off"]');
  ok('désactivé : aucun lecteur chargé', (await page.locator('[data-testid="video-frame"]').count()) === 0);
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await page.getByTestId('video-add').click();
  await page.fill('[data-testid="video-link"]', 'https://vimeo.com/123456789');
  await page.waitForTimeout(600);
  ok('désactivé : aucun appel à la plateforme à l’ajout', (await S(() => window.__videoCalls.length)) === before);
  await page.keyboard.press('Escape');
  await S(() => window.__store.getState().updateSettings({ videoOnline: true }));
  await shot(page, 'shots/videos/08-bibliotheque-normal.png');

  // ── 8. Partage et corbeille ──
  const built = await S(async (id) => {
    const m = await import('/src/features/share/sharePackage.ts');
    const r = await m.buildSharePackage({ kind: 'items', ids: [id] }, { includeBooks: true });
    return { b64: window.__u8tob64(r.bytes), skipped: r.summary.skipped };
  }, vb.id);
  const z = await JSZip.loadAsync(Buffer.from(built.b64, 'base64'));
  const manifest = JSON.parse(await z.file('manifest.json').async('string'));
  const data = JSON.parse(await z.file('data.json').async('string'));
  const files = Object.keys(z.files).filter((n) => n.startsWith('files/'));
  ok('partage : la vidéo voyage sans fichier ni transcription', manifest.books[0].format === 'video' && manifest.books[0].sha256 === null && files.length === 0 && built.skipped.length === 0, { files, skipped: built.skipped });
  ok('partage : sa fiche (plateforme, identifiant) et ses extraits', data.books[0].video.provider === 'youtube' && data.books[0].video.id === 'AbCdEfGhIjK' && data.highlights.length === 2);
  const prev = await S(async (b64) => (await import('/src/features/share/sharePackage.ts')).readSharePackage(window.__b64tou8(b64)), built.b64);
  ok('réception chez soi : la vidéo est reconnue (pas de doublon)', prev.books[0].local && prev.books[0].local.id === vb.id && prev.booksWithoutFile === 0, prev.books[0]);
  const trash = await S((id) => {
    const s = window.__store.getState();
    const e = s.trashDelete('book', id);
    return { files: e.files, gone: !window.__store.getState().books.some((b) => b.id === id) };
  }, vb.id);
  ok('corbeille : seule la transcription sera effacée au vidage', trash.gone && JSON.stringify(trash.files) === JSON.stringify([{ ownerId: vb.id, fileName: 'transcript.json' }]), trash.files);

  const rem = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  ok('aucune erreur navigateur', rem.length === 0, rem.join('\n'));
});

// Réception dans une bibliothèque neuve : la vidéo arrive avec sa fiche, sans transcription.
console.log(`\n${passed} vérifications passées`);
