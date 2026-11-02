// Passerelle réseau des vidéos (electron/video-net.cjs), contre un FAUX serveur local (jamais le vrai
// réseau) : oEmbed (titre, chaîne, miniature), durée, sous-titres YouTube (lecteur Android, puis repli
// sur la page de la vidéo), formats json3 / srv3 / XML, choix de la piste, adresses refusées, réglage
// désactivé (aucune requête).
// Lancer : node scripts/test-video-net.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vn = require('../electron/video-net.cjs');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
  passed++;
  console.log('  ok', name);
};

// ── Lecture des formats ──
ok('json3 : segments réunis, entités décodées', JSON.stringify(vn.parseCaptions('{"events":[{"tStartMs":1000,"dDurationMs":2000,"segs":[{"utf8":"Bonjour "},{"utf8":"&amp; bienvenue"}]},{"tStartMs":3000,"segs":[{"utf8":"\\n"}]}]}')) === JSON.stringify([{ s: 1000, d: 2000, t: 'Bonjour & bienvenue' }]));
ok('srv3 : <p t d>', JSON.stringify(vn.parseCaptions('<timedtext><body><p t="1500" d="900"><s>Deux</s><s> mots</s></p></body></timedtext>')) === JSON.stringify([{ s: 1500, d: 900, t: 'Deux mots' }]));
ok('XML ancien, entités doublement encodées', vn.parseCaptions('<transcript><text start="2.5" dur="1">L&amp;#39;idée</text></transcript>')[0].t === 'L’idée'.replace('’', "'"));
ok('piste : français écrit à la main avant l’automatique', vn.pickTrack([{ baseUrl: 'a', languageCode: 'fr', kind: 'asr' }, { baseUrl: 'b', languageCode: 'en' }, { baseUrl: 'c', languageCode: 'fr' }]).baseUrl === 'c');
ok('piste : automatique en français avant l’anglais écrit', vn.pickTrack([{ baseUrl: 'b', languageCode: 'en' }, { baseUrl: 'a', languageCode: 'fr', kind: 'asr' }]).baseUrl === 'a');
ok('chapitres : minutage avant ou après le titre ; rien sans 0:00', vn.parseChapters('Intro (0:00)\nPartie 1 - 3:20').length === 2 && vn.parseChapters('Rendez-vous à 12:30\n5:00 seul').length === 0);
ok('page de la vidéo : objet du lecteur extrait', vn.playerResponseFromPage('<script>var ytInitialPlayerResponse = {"a":{"b":"}"},"c":1};var x=1;</script>').c === 1);
ok('miniatures : seulement les serveurs d’images des plateformes', vn.thumbAllowed('https://i.ytimg.com/vi/x/hq.jpg') && !vn.thumbAllowed('https://evil.example/x.jpg') && !vn.thumbAllowed('http://i.ytimg.com/x.jpg'));

// ── Faux serveur ──
const hits = [];
let androidFails = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  hits.push(`${req.method} ${u.pathname}`);
  const json = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
  if (u.pathname === '/yt/oembed') return json({ title: 'Un cours', author_name: 'Une chaîne', thumbnail_url: `http://127.0.0.1:${server.address().port}/img/t.jpg` });
  if (u.pathname === '/vimeo/api/oembed.json') return json({ title: 'Conférence', author_name: 'Auteur V', duration: 1234 });
  if (u.pathname === '/dm/services/oembed') return json({ title: 'Docu', author_name: 'Auteur D' });
  if (u.pathname === '/dmapi/video/x7abcde') return json({ duration: 321 });
  const tracks = [{ baseUrl: `http://127.0.0.1:${server.address().port}/yt/api/timedtext?v=AbCdEfGhIjK&lang=fr&fmt=srv3`, languageCode: 'fr', kind: 'asr' }];
  if (u.pathname === '/yt/youtubei/v1/player') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      if (androidFails || b.videoId !== 'AbCdEfGhIjK') return json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
      json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } }, videoDetails: { lengthSeconds: '600', shortDescription: 'Un cours.\n0:00 Introduction\n2:15 - Le doute\n8:40 Conclusion' } });
    });
    return;
  }
  if (u.pathname === '/yt/watch') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><script>var ytInitialPlayerResponse = ${JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } }, videoDetails: { lengthSeconds: '600' } })};</script></html>`);
  }
  if (u.pathname === '/yt/api/timedtext') {
    if (u.searchParams.get('fmt') === 'json3') return json({ events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Première phrase.' }] }, { tStartMs: 3000, dDurationMs: 3000, segs: [{ utf8: 'Seconde.' }] }] });
    res.writeHead(200);
    return res.end('');
  }
  if (u.pathname === '/img/t.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let enabled = true;
const net = vn.createVideoNet({ enabled: () => enabled, testBase: base });

const m = await net.meta('youtube', 'AbCdEfGhIjK');
ok('YouTube : titre, chaîne, miniature', m.ok && m.title === 'Un cours' && m.author === 'Une chaîne' && m.thumb.endsWith('/img/t.jpg'), m);
const t = await net.thumb(m.thumb);
ok('miniature en data: URL', typeof t === 'string' && t.startsWith('data:image/jpeg;base64,'));
const mv = await net.meta('vimeo', '123456');
ok('Vimeo : titre, chaîne, durée', mv.ok && mv.title === 'Conférence' && mv.duration === 1234, mv);
const md = await net.meta('dailymotion', 'x7abcde');
ok('Dailymotion : titre, chaîne, durée', md.ok && md.author === 'Auteur D' && md.duration === 321, md);
const tr = await net.transcript('youtube', 'AbCdEfGhIjK', 'fr');
ok('chapitres lus dans la description', tr.chapters?.length === 3 && tr.chapters[1].s === 135 && tr.chapters[1].t === 'Le doute', tr.chapters);
ok('sous-titres : json3 demandé, répliques, durée', tr.ok && tr.cues.length === 2 && tr.cues[0].t === 'Première phrase.' && tr.duration === 600 && tr.auto === true && tr.lang === 'fr', tr);
androidFails = true;
hits.length = 0;
const tr2 = await net.transcript('youtube', 'AbCdEfGhIjK', 'fr');
ok('lecteur refusé : repli sur la page de la vidéo', tr2.ok && hits.includes('GET /yt/watch'), hits);
ok('identifiant invalide : refusé sans requête', !(await net.meta('youtube', '../etc')).ok);
ok('Vimeo : pas de transcription automatique', !(await net.transcript('vimeo', '123456')).ok);
enabled = false;
hits.length = 0;
const off = await net.meta('youtube', 'AbCdEfGhIjK');
ok('désactivé : aucune requête', off.off === true && hits.length === 0 && (await net.thumb(m.thumb)) === null && (await net.transcript('youtube', 'AbCdEfGhIjK')).off === true && hits.length === 0);

const prod = vn.createVideoNet({ enabled: () => true });
const refused = await prod.thumb('https://evil.example/x.jpg');
ok('production : adresse étrangère refusée (miniature)', refused === null);

server.close();
console.log(`\n${passed} vérifications passées`);
