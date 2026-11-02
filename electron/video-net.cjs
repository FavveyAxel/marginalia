// ─────────────────────────────────────────────────────────────
// Vidéos : titre et chaîne d'une vidéo (oEmbed officiel des plateformes), durée, sous-titres
// YouTube (transcription) et chapitres (lus dans la description de la vidéo).
//
// Connexions (processus principal seulement, jamais le rendu ; réglage « Vidéos en ligne », activé
// par défaut ; désactivé : AUCUNE requête) :
//  - https://www.youtube.com/oembed?…                         (titre, chaîne)
//  - https://www.youtube.com/youtubei/v1/player               (liste des sous-titres, durée)
//  - https://www.youtube.com/api/timedtext?…                  (texte des sous-titres)
//  - https://www.youtube.com/watch?v=…                        (repli : même liste, lue dans la page)
//  - https://vimeo.com/api/oembed.json?…                      (titre, chaîne, durée)
//  - https://www.dailymotion.com/services/oembed?…            (titre, chaîne)
//  - https://api.dailymotion.com/video/<id>?fields=duration   (durée)
//  - miniature : https://i.ytimg.com/…, https://i.vimeocdn.com/…, https://s1.dmcdn.net/… (une fois, à l'ajout)
// Seul l'identifiant de la vidéo part ; aucun compte, aucun identifiant de l'utilisateur. Chaque
// adresse (et chaque redirection) est contrôlée ; réponses de taille limitée ; délai maximal.
// L'interface officielle de YouTube ne donne pas les sous-titres sans compte : on passe par celle de
// son lecteur, sans garantie (elle peut changer) ; en cas d'échec, l'app le dit et la vidéo reste
// utilisable (extraits notés à la main, avec le minutage).
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const https = require('node:https');

const TIMEOUT_MS = 12000;
const MAX_JSON = 4 * 1024 * 1024;
const MAX_PAGE = 6 * 1024 * 1024;
const MAX_CUES = 20000;

const ID = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d{1,12}$/,
  dailymotion: /^[A-Za-z0-9]{5,12}$/,
};

class NetError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function parseUrl(u) {
  try {
    const x = new URL(u);
    if (x.username || x.password) return null;
    return x;
  } catch {
    return null;
  }
}
const isLocalTest = (x) => x.protocol === 'http:' && x.hostname === '127.0.0.1';

const PROD_HOSTS = new Set(['www.youtube.com', 'vimeo.com', 'www.dailymotion.com', 'api.dailymotion.com']);
const MAX_THUMB = 2 * 1024 * 1024;
/** Miniatures : seulement les serveurs d'images des trois plateformes. */
function thumbAllowed(u, local) {
  const x = parseUrl(u);
  if (!x) return false;
  if (local) return isLocalTest(x);
  if (x.protocol !== 'https:') return false;
  const h = x.hostname.toLowerCase();
  return h === 'i.ytimg.com' || h === 'i.vimeocdn.com' || /^s\d\.dmcdn\.net$/.test(h) || h === 'www.dailymotion.com';
}

/**
 * Requête contrôlée (GET ou POST JSON) : chaque adresse et chaque redirection passent par `allow` ;
 * délai total ; taille maximale ; pas de cookie gardé.
 */
function request(url, { allow, limit, method = 'GET', body = null, headers = {}, timeoutMs = TIMEOUT_MS, maxRedirects = 4, onRequest, raw = false }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let current = null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => {
      if (current) current.destroy();
      finish(reject, new NetError('Délai dépassé.', 'timeout'));
    }, timeoutMs);
    const go = (u, left, m, b) => {
      if (!allow(u)) return finish(reject, new NetError('Adresse refusée.', 'adresse'));
      const mod = u.startsWith('https:') ? https : http;
      if (onRequest) onRequest(u, m);
      const h = { 'User-Agent': 'Mozilla/5.0 (Marginalia)', 'Accept-Language': 'fr,en;q=0.8', ...headers };
      if (b) h['Content-Length'] = Buffer.byteLength(b);
      let req;
      try {
        req = mod.request(u, { method: m, headers: h, agent: false }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (left <= 0) return finish(reject, new NetError('Trop de redirections.', 'reseau'));
            let next;
            try {
              next = new URL(res.headers.location, u).toString();
            } catch {
              return finish(reject, new NetError('Redirection invalide.', 'reseau'));
            }
            const keep = res.statusCode === 307 || res.statusCode === 308;
            return go(next, left - 1, keep ? m : 'GET', keep ? b : null);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return finish(reject, new NetError(`HTTP ${res.statusCode}`, res.statusCode === 404 ? 'absent' : 'reseau'));
          }
          const chunks = [];
          let n = 0;
          res.on('data', (c) => {
            n += c.length;
            if (n > limit) {
              finish(reject, new NetError('Réponse trop longue.', 'taille'));
              res.destroy();
            } else chunks.push(c);
          });
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            finish(resolve, raw ? { buf, type: String(res.headers['content-type'] || '') } : buf.toString('utf8'));
          });
          res.on('error', (e) => finish(reject, e));
          res.on('aborted', () => finish(reject, new NetError('Connexion interrompue.', 'reseau')));
        });
      } catch (e) {
        return finish(reject, e);
      }
      current = req;
      req.on('error', (e) => finish(reject, new NetError(e && e.message ? e.message : 'Réseau indisponible.', 'reseau')));
      req.end(b || undefined);
    };
    go(url, maxRedirects, method, body);
  });
}

// ── Lecture des réponses ─────────────────────────────────────

const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
// Les sous-titres XML arrivent souvent doublement encodés (« &amp;#39; ») : deux passes.
const clean = (t) => decodeEntities(decodeEntities(String(t || '').replace(/<[^>]*>/g, ''))).replace(/[​‎‏]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Texte des sous-titres → liste de répliques { s, d, t } (début et durée en ms, texte).
 * Formats lus : json3 (events/segs), srv3 (<p t d><s>…</s></p>) et l'ancien XML (<text start dur>).
 */
function parseCaptions(body) {
  const out = [];
  const text = String(body || '').trim();
  if (!text) return out;
  if (text[0] === '{') {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return out;
    }
    for (const ev of Array.isArray(j.events) ? j.events : []) {
      if (!Array.isArray(ev.segs)) continue;
      const t = clean(ev.segs.map((s) => (s && typeof s.utf8 === 'string' ? s.utf8 : '')).join(''));
      if (!t) continue;
      out.push({ s: Math.max(0, Math.round(Number(ev.tStartMs) || 0)), d: Math.max(0, Math.round(Number(ev.dDurationMs) || 0)), t });
      if (out.length >= MAX_CUES) break;
    }
    return out;
  }
  const p = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = p.exec(text)) && out.length < MAX_CUES) {
    const at = /\bt="(\d+)"/.exec(m[1]);
    const du = /\bd="(\d+)"/.exec(m[1]);
    const t = clean(m[2]);
    if (at && t) out.push({ s: Number(at[1]), d: du ? Number(du[1]) : 0, t });
  }
  if (out.length) return out;
  const x = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  while ((m = x.exec(text)) && out.length < MAX_CUES) {
    const st = /\bstart="([\d.]+)"/.exec(m[1]);
    const du = /\bdur="([\d.]+)"/.exec(m[1]);
    const t = clean(m[2]);
    if (st && t) out.push({ s: Math.round(Number(st[1]) * 1000), d: du ? Math.round(Number(du[1]) * 1000) : 0, t });
  }
  return out;
}

/**
 * Chapitres d'une vidéo YouTube, lus dans sa description (c'est ainsi que YouTube les définit) : une
 * ligne par chapitre, minutage puis titre (« 0:00 Introduction », « 12:34 - Le doute »), ou titre puis
 * minutage. Admis seulement s'ils commencent à 0:00, sont au moins deux et vont croissant.
 */
function parseChapters(description) {
  const out = [];
  const T = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
  const before = new RegExp('^\\s*[\\-•▶►·*\\[(]*\\s*' + T + '\\s*[\\])]?\\s*[-–—:|.)]?\\s*(.+?)\\s*$');
  const after = new RegExp('^\\s*(.+?)\\s*[-–—:|(\\[]\\s*' + T + '\\s*[)\\]]?\\s*$');
  const sec = (t) => t.split(':').reduce((n, x) => n * 60 + Number(x), 0);
  for (const raw of String(description || '').split(/\r?\n/).slice(0, 400)) {
    const line = raw.trim();
    if (!line || line.length > 160) continue;
    let m = before.exec(line);
    let t;
    let title;
    if (m) {
      t = sec(m[1]);
      title = m[2];
    } else if ((m = after.exec(line))) {
      t = sec(m[2]);
      title = m[1];
    } else continue;
    title = clean(title).replace(/^[-–—:|.\s]+|[-–—:|\s]+$/g, '').slice(0, 140);
    if (!title || !Number.isFinite(t)) continue;
    if (out.length && t <= out[out.length - 1].s) continue;
    out.push({ s: t, t: title });
    if (out.length >= 200) break;
  }
  return out.length >= 2 && out[0].s === 0 ? out : [];
}

/** Piste préférée : français écrit à la main, puis français automatique, puis toute piste écrite, puis automatique. */
function pickTrack(tracks, lang = 'fr') {
  const list = (Array.isArray(tracks) ? tracks : []).filter((t) => t && typeof t.baseUrl === 'string' && typeof t.languageCode === 'string');
  const is = (t, l) => t.languageCode === l || t.languageCode.startsWith(l + '-');
  const manual = (t) => t.kind !== 'asr';
  return list.find((t) => is(t, lang) && manual(t)) || list.find((t) => is(t, lang)) || list.find(manual) || list[0] || null;
}

/** Liste des pistes dans la page de la vidéo (repli) : objet ytInitialPlayerResponse. */
function playerResponseFromPage(html) {
  const i = html.indexOf('ytInitialPlayerResponse');
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  // Fin de l'objet : on compte les accolades hors des chaînes.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, k + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ── Service ──────────────────────────────────────────────────

function endpoints(base) {
  if (!base) {
    return {
      ytOembed: 'https://www.youtube.com/oembed',
      ytPlayer: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      ytWatch: 'https://www.youtube.com/watch',
      vimeoOembed: 'https://vimeo.com/api/oembed.json',
      dmOembed: 'https://www.dailymotion.com/services/oembed',
      dmApi: 'https://api.dailymotion.com/video/',
    };
  }
  const b = String(base).replace(/\/+$/, '');
  return {
    ytOembed: `${b}/yt/oembed`,
    ytPlayer: `${b}/yt/youtubei/v1/player?prettyPrint=false`,
    ytWatch: `${b}/yt/watch`,
    vimeoOembed: `${b}/vimeo/api/oembed.json`,
    dmOembed: `${b}/dm/services/oembed`,
    dmApi: `${b}/dmapi/video/`,
  };
}

function createVideoNet(o) {
  const local = !!o.testBase;
  const ep = endpoints(local ? o.testBase : '');
  const diag = o.diag || (() => {});
  const allow = (u) => {
    const x = parseUrl(u);
    if (!x) return false;
    if (local) return isLocalTest(x);
    return x.protocol === 'https:' && PROD_HOSTS.has(x.hostname.toLowerCase());
  };
  const ask = (url, opts = {}) => request(url, { allow, limit: MAX_JSON, onRequest: o.onRequest, ...opts });
  const json = async (url, opts) => {
    const body = await ask(url, opts);
    try {
      return JSON.parse(body);
    } catch {
      throw new NetError('Réponse illisible.', 'format');
    }
  };
  const OFF = { ok: false, off: true, error: 'Les vidéos en ligne sont désactivées dans les Réglages.' };
  const valid = (provider, id) => Object.prototype.hasOwnProperty.call(ID, provider) && ID[provider].test(String(id || ''));

  /** Titre, chaîne et durée (si la plateforme la donne). */
  async function meta(provider, id) {
    if (!o.enabled()) return OFF;
    if (!valid(provider, id)) return { ok: false, error: 'Vidéo non reconnue.' };
    try {
      if (provider === 'youtube') {
        const j = await json(`${ep.ytOembed}?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { headers: { Accept: 'application/json' } });
        return { ok: true, title: str(j.title), author: str(j.author_name), duration: 0, thumb: str(j.thumbnail_url, 500) };
      }
      if (provider === 'vimeo') {
        const j = await json(`${ep.vimeoOembed}?url=${encodeURIComponent('https://vimeo.com/' + id)}`, { headers: { Accept: 'application/json' } });
        return { ok: true, title: str(j.title), author: str(j.author_name), duration: num(j.duration), thumb: str(j.thumbnail_url, 500) };
      }
      const [j, d] = await Promise.allSettled([
        json(`${ep.dmOembed}?format=json&url=${encodeURIComponent('https://www.dailymotion.com/video/' + id)}`, { headers: { Accept: 'application/json' } }),
        json(`${ep.dmApi}${id}?fields=duration`, { headers: { Accept: 'application/json' } }),
      ]);
      if (j.status !== 'fulfilled') throw j.reason;
      return { ok: true, title: str(j.value.title), author: str(j.value.author_name), duration: d.status === 'fulfilled' ? num(d.value.duration) : 0, thumb: str(j.value.thumbnail_url, 500) };
    } catch (e) {
      diag('video', 'meta', provider, e && e.code);
      return { ok: false, error: e && e.code === 'absent' ? 'Vidéo introuvable (privée ou supprimée ?).' : 'Impossible de joindre la plateforme.' };
    }
  }

  /** Liste des pistes de sous-titres d'une vidéo YouTube (lecteur Android, puis page de la vidéo). */
  async function ytTracks(id, lang) {
    const body = JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: lang, gl: 'FR' } }, videoId: id });
    try {
      const j = await json(ep.ytPlayer, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' } });
      const tracks = j && j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (Array.isArray(tracks) && tracks.length) return { tracks, details: j.videoDetails || {} };
      if (j && j.playabilityStatus && j.playabilityStatus.status && j.playabilityStatus.status !== 'OK') diag('video', 'lecteur', j.playabilityStatus.status);
    } catch (e) {
      diag('video', 'lecteur', e && e.code);
    }
    // Repli : la page de la vidéo (cookie de consentement générique, pour éviter la page « Avant de continuer »).
    const html = await ask(`${ep.ytWatch}?v=${id}&hl=${lang}`, { limit: MAX_PAGE, headers: { Accept: 'text/html', Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
    const pr = playerResponseFromPage(html);
    const tracks = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    return { tracks: Array.isArray(tracks) ? tracks : [], details: (pr && pr.videoDetails) || {} };
  }

  /** Transcription d'une vidéo YouTube, depuis ses sous-titres (écrits à la main de préférence). */
  async function transcript(provider, id, lang = 'fr') {
    if (!o.enabled()) return OFF;
    if (provider !== 'youtube') return { ok: false, error: 'La transcription automatique n’existe que pour YouTube.' };
    if (!valid(provider, id)) return { ok: false, error: 'Vidéo non reconnue.' };
    lang = /^[a-z]{2}$/.test(String(lang)) ? lang : 'fr';
    try {
      const { tracks, details } = await ytTracks(id, lang);
      const chapters = parseChapters(details.shortDescription);
      const track = pickTrack(tracks, lang);
      if (!track) return { ok: false, none: true, chapters, duration: num(details.lengthSeconds), error: 'Cette vidéo n’a pas de sous-titres.' };
      const base = new URL(track.baseUrl, ep.ytWatch);
      base.searchParams.delete('fmt');
      base.searchParams.set('fmt', 'json3');
      let cues = parseCaptions(await ask(base.toString(), { headers: { Accept: 'application/json' } }));
      if (!cues.length) {
        // Certaines pistes ne répondent qu'au format par défaut.
        base.searchParams.delete('fmt');
        cues = parseCaptions(await ask(base.toString(), { headers: { Accept: 'text/xml' } }));
      }
      if (!cues.length) return { ok: false, chapters, error: 'YouTube n’a pas donné le texte des sous-titres. Réessayez plus tard.' };
      return { ok: true, lang: track.languageCode.slice(0, 2), auto: track.kind === 'asr', cues, chapters, duration: num(details.lengthSeconds) };
    } catch (e) {
      diag('video', 'transcription', e && e.code);
      return { ok: false, error: 'Impossible de récupérer les sous-titres pour l’instant.' };
    }
  }

  /** Miniature (adresse donnée par l'oEmbed) → data: URL ; null si refusée ou illisible. */
  async function thumb(url) {
    if (!o.enabled() || !thumbAllowed(url, local)) return null;
    try {
      const r = await request(url, { allow: (u) => thumbAllowed(u, local), limit: MAX_THUMB, raw: true, headers: { Accept: 'image/*' }, onRequest: o.onRequest });
      const type = /^image\/(jpeg|png|webp)/.exec(r.type);
      if (!type || !r.buf.length) return null;
      return `data:image/${type[1]};base64,${r.buf.toString('base64')}`;
    } catch (e) {
      diag('video', 'miniature', e && e.code);
      return null;
    }
  }

  return { meta, transcript, thumb };
}

module.exports = { createVideoNet, parseCaptions, parseChapters, pickTrack, playerResponseFromPage, thumbAllowed, ID, NetError };
