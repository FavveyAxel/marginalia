// Fabriques de livres de test (EPUB, PDF) partagées par les scripts de test et de captures.
// - epubFrench() : livre français « réaliste » (pages imprimées, chiffres romains, plusieurs chapitres,
//   intertitres, citation, liste, poème, appel de note) — revue visuelle des mises en page du lecteur ;
// - epubPrinted() / epubPlain() / pdfWithLabels() : mêmes fixtures que scripts/test-reader-pages.mjs
//   (copie à l'identique ; ce dernier garde les siennes pour rester autonome).
import JSZip from 'jszip';

// ── Briques ──────────────────────────────────────────────────

const WORDS =
  'la raison le jugement la volonté une idée claire et distincte le doute méthodique conduit l’esprit vers la vérité ' +
  'car il faut une fois en sa vie se défaire de toutes les opinions reçues et recommencer tout de nouveau dès les fondements ' +
  'or les sens nous trompent quelquefois et il est de la prudence de ne se fier jamais entièrement à ceux qui nous ont une fois trompés';
const W = WORDS.split(' ');

/** Paragraphe déterministe d'environ `n` caractères, commençant par `lead`. */
export function para(lead, n, seed) {
  let out = lead;
  let i = seed * 7;
  while (out.length < n) out += ' ' + W[i++ % W.length];
  return out + '.';
}

export const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;

export async function zipEpub(title, files, nav, { author = 'René Descartes' } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const names = Object.keys(files);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', nav);
  for (const [n, src] of Object.entries(files)) zip.file('OEBPS/' + n, src);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

// ── Livre français réaliste ──────────────────────────────────

// Phrases dans la langue des Méditations (traduction du duc de Luynes, 1647, domaine public),
// reprises et prolongées pour donner aux pages une longueur d'édition imprimée.
const PHRASES = [
  'Il y a déjà quelque temps que je me suis aperçu que, dès mes premières années, j’avais reçu quantité de fausses opinions pour véritables, et que ce que j’ai depuis fondé sur des principes si mal assurés ne pouvait être que fort douteux et incertain.',
  'De façon qu’il me fallait entreprendre sérieusement une fois en ma vie de me défaire de toutes les opinions que j’avais reçues jusques alors en ma créance, et commencer tout de nouveau dès les fondements, si je voulais établir quelque chose de ferme et de constant dans les sciences.',
  'Mais cette entreprise me semblant être fort grande, j’ai attendu que j’eusse atteint un âge qui fût si mûr que je n’en pusse espérer d’autre après lui, auquel je fusse plus propre à l’exécuter.',
  'Tout ce que j’ai reçu jusqu’à présent pour le plus vrai et assuré, je l’ai appris des sens, ou par les sens : or j’ai quelquefois éprouvé que ces sens étaient trompeurs, et il est de la prudence de ne se fier jamais entièrement à ceux qui nous ont une fois trompés.',
  'Toutefois, et bien que les sens nous trompent quelquefois touchant les choses peu sensibles et fort éloignées, il s’en rencontre peut-être beaucoup d’autres desquelles on ne peut pas raisonnablement douter.',
  'Combien de fois m’est-il arrivé de songer, la nuit, que j’étais en ce lieu, que j’étais habillé, que j’étais auprès du feu, quoique je fusse tout nu dedans mon lit ?',
  'Il me semble bien à présent que ce n’est point avec des yeux endormis que je regarde ce papier ; que cette tête que je remue n’est point assoupie ; que c’est avec dessein et de propos délibéré que j’étends cette main et que je la sens.',
  'Je supposerai donc qu’il y a, non point un vrai Dieu, qui est la souveraine source de vérité, mais un certain mauvais génie, non moins rusé et trompeur que puissant, qui a employé toute son industrie à me tromper.',
  'Je penserai que le ciel, l’air, la terre, les couleurs, les figures, les sons et toutes les choses extérieures que nous voyons ne sont que des illusions et tromperies, dont il se sert pour surprendre ma crédulité.',
  'Archimède, pour tirer le globe terrestre de sa place et le transporter en un autre lieu, ne demandait rien qu’un point qui fût fixe et assuré.',
  'Ainsi j’aurai droit de concevoir de hautes espérances, si je suis assez heureux pour trouver seulement une chose qui soit certaine et indubitable.',
  'De sorte qu’après y avoir bien pensé, et avoir soigneusement examiné toutes choses, enfin il faut conclure, et tenir pour constant que cette proposition, je suis, j’existe, est nécessairement vraie toutes les fois que je la prononce, ou que je la conçois en mon esprit.',
  'Mais qu’est-ce donc que je suis ? Une chose qui pense. Qu’est-ce qu’une chose qui pense ? C’est-à-dire une chose qui doute, qui conçoit, qui affirme, qui nie, qui veut, qui ne veut pas, qui imagine aussi, et qui sent.',
  'Prenons pour exemple ce morceau de cire qui vient d’être tiré de la ruche : il n’a pas encore perdu la douceur du miel qu’il contenait, il retient encore quelque chose de l’odeur des fleurs dont il a été recueilli.',
];

/** Paragraphe de `n` caractères environ, fait de phrases entières à partir de la phrase `seed`. */
function prose(n, seed, lead = '') {
  let out = lead;
  let i = seed;
  while (out.length < n) out += (out ? ' ' : '') + PHRASES[i++ % PHRASES.length];
  return out;
}

const pbk = (id, label, aria = false) =>
  aria ? `<span role="doc-pagebreak" id="${id}" aria-label="${label}"></span>` : `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;

/** Paragraphe coupé au milieu par le repère de page `label` (après ~`at` caractères). */
function midPara(n, seed, label, at = 0.5, lead = '') {
  const p = prose(n, seed, lead);
  const cut = p.indexOf(' ', Math.floor(p.length * at));
  return `<p>${p.slice(0, cut + 1)}${pbk('page_' + label, label)}${p.slice(cut + 1)}</p>`;
}

/** Passage repérable (début de la page 2, au milieu d'un paragraphe) : sert au surlignage à cheval. */
export const FRENCH_SPAN_MARK = '2';
/** Passage destiné à porter une note de lecteur. */
export const FRENCH_NOTE_TEXT = 'Mais qu’est-ce donc que je suis ? Une chose qui pense.';

/**
 * EPUB 3 « Méditations métaphysiques » (≈ 9 pages imprimées : v, vi, vii, 1…7, page-list) :
 * Avertissement (romains), Méditation première (intertitres h2, citation, liste, appel de note),
 * Méditation seconde (poème en exergue, h2, h3), Notes du traducteur (note de fin).
 */
export async function epubFrench({ title = 'Méditations métaphysiques' } = {}) {
  const avert = xhtml(
    'Avertissement',
    `${pbk('page_v', 'v')}<h1>Avertissement du traducteur</h1>` +
      `<p>${prose(900, 2, 'Le lecteur trouvera ici les six méditations que l’auteur a d’abord écrites en latin, rendues en notre langue avec le plus de fidélité qu’il nous a été possible.')}</p>` +
      midPara(1300, 4, 'vi', 0.55) +
      `<p>${prose(700, 9)}</p>${pbk('page_vii', 'vii')}<p>${prose(1100, 10, 'Il reste à dire un mot de l’ordre que l’on a suivi.')}</p>`,
  );
  const med1 = xhtml(
    'Méditation première',
    `${pbk('page_1', '1')}<h1>Méditation première</h1><h2>Des choses que l’on peut révoquer en doute</h2>` +
      `<p>${prose(900, 0)}</p>` +
      midPara(1500, 2, '2', 0.45) +
      `<blockquote><p>L’homme n’est qu’un roseau, le plus faible de la nature ; mais c’est un roseau pensant.</p><p>— Pascal, <i>Pensées</i></p></blockquote>` +
      `<p>${prose(500, 4, 'Pour conduire ce doute avec ordre, je m’impose quatre règles :')}</p>` +
      `<ol><li>ne recevoir jamais aucune chose pour vraie que je ne la connusse évidemment être telle ;</li>` +
      `<li>diviser chacune des difficultés en autant de parcelles qu’il se pourrait ;</li>` +
      `<li>conduire par ordre mes pensées, en commençant par les objets les plus simples ;</li>` +
      `<li>faire partout des dénombrements si entiers que je fusse assuré de ne rien omettre.</li></ol>` +
      `${pbk('page_3', '3', true)}<h2>Du songe et de la veille</h2>` +
      `<p>${prose(1100, 5)}<a epub:type="noteref" href="notes.xhtml#n1" id="r1">1</a></p>` +
      midPara(1500, 7, '4', 0.5) +
      `<p>${prose(900, 8)}</p>`,
  );
  const med2 = xhtml(
    'Méditation seconde',
    `${pbk('page_5', '5')}<h1>Méditation seconde</h1><h2>De la nature de l’esprit humain</h2>` +
      `<blockquote class="poem"><p>Il pleure dans mon cœur<br/>Comme il pleut sur la ville ;<br/>Quelle est cette langueur<br/>Qui pénètre mon cœur ?</p><p>— Verlaine, <i>Romances sans paroles</i></p></blockquote>` +
      `<p>${prose(1000, 9)}</p>` +
      midPara(1500, 11, '6', 0.4) +
      `<h3>Le morceau de cire</h3><p>${prose(1100, 13)}</p>${pbk('page_7', '7')}<p>${prose(1600, 12)}</p>`,
  );
  const notes = xhtml(
    'Notes du traducteur',
    `<h1>Notes du traducteur</h1><aside epub:type="footnote" id="n1"><p><a href="med1.xhtml#r1">1.</a> L’argument du rêve est repris de la tradition sceptique ; l’auteur le pousse plus loin que ses devanciers en l’étendant aux vérités les plus simples.</p></aside>`,
  );
  const plist = [
    ['avert.xhtml#page_v', 'v'],
    ['avert.xhtml#page_vi', 'vi'],
    ['avert.xhtml#page_vii', 'vii'],
    ['med1.xhtml#page_1', '1'],
    ['med1.xhtml#page_2', '2'],
    ['med1.xhtml#page_3', '3'],
    ['med1.xhtml#page_4', '4'],
    ['med2.xhtml#page_5', '5'],
    ['med2.xhtml#page_6', '6'],
    ['med2.xhtml#page_7', '7'],
  ];
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="avert.xhtml">Avertissement du traducteur</a></li><li><a href="med1.xhtml">Méditation première</a></li><li><a href="med2.xhtml">Méditation seconde</a></li><li><a href="notes.xhtml">Notes du traducteur</a></li></ol></nav>` +
      `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>`,
  );
  return zipEpub(title, { 'avert.xhtml': avert, 'med1.xhtml': med1, 'med2.xhtml': med2, 'notes.xhtml': notes }, nav);
}

// ── Fixtures de scripts/test-reader-pages.mjs (copie) ────────

/**
 * EPUB 3 à pages imprimées. Préface : ix (début), x (milieu d'un paragraphe), xi (entre deux paragraphes).
 * Chapitre premier : 1 (début), 2 (milieu), 3 (entre), 4 (milieu). Chapitre II : 5 (début), 6, 7.
 * `pageList` : nav page-list (sinon seulement les repères pagebreak du texte, epub:type et ARIA).
 */
export async function epubPrinted({ pageList = true, title = 'Méditations paginées' } = {}) {
  const pb = (id, label, aria = false) =>
    aria ? `<span role="doc-pagebreak" id="${id}" aria-label="${label}"></span>` : `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;
  const mid = (lead, label, id, seed, aria) => {
    const p = para(lead, 900, seed);
    const cut = p.indexOf(' ', 450);
    return `<p>${p.slice(0, cut + 1)}${pb(id, label, aria)}${p.slice(cut + 1)}</p>`;
  };
  const pre = xhtml(
    'Préface',
    `${pb('page_ix', 'ix')}<h1>Préface</h1><p>${para('Préface du traducteur, qui ouvre ce volume', 700, 1)}</p>` +
      mid('Le lecteur trouvera ici', 'x', 'page_x', 2) +
      `<p>${para('Fin de la page dix', 500, 3)}</p>${pb('page_xi', 'xi')}<p>${para('Début de la page onze en chiffres romains', 900, 4)}</p>`,
  );
  const ch1 = xhtml(
    'Chapitre premier',
    `${pb('page_1', '1')}<h1>Chapitre premier</h1><p>${para('Il y a déjà quelque temps', 1100, 5)}</p>` +
      mid('Je supposerai donc', '2', 'page_2', 6) +
      `<p>${para('Fin de la page deux', 600, 7)}</p>${pb('page_3', '3', true)}<p>${para('Début de la page trois et du doute', 1200, 8)}</p>` +
      mid('Mais aussitôt après', '4', 'page_4', 9, true) +
      `<p>${para('Ce qui suit la page quatre', 1400, 10)}</p>`,
  );
  const ch2 = xhtml(
    'Chapitre II',
    `${pb('page_5', '5')}<h1>Chapitre II</h1><p>${para('De la nature de l’esprit humain', 1300, 11)}</p>` +
      mid('Archimède, pour tirer le globe', '6', 'page_6', 12) +
      `<p>${para('Je suppose donc que toutes les choses', 1500, 13)}</p>${pb('page_7', '7')}<p>${para('Début de la page sept', 1600, 14)}</p>` +
      `<p>${para('Dernier paragraphe du livre', 1800, 15)}</p>`,
  );
  const plist = [
    ['pre.xhtml#page_ix', 'ix'],
    ['pre.xhtml#page_x', 'x'],
    ['pre.xhtml#page_xi', 'xi'],
    ['ch1.xhtml#page_1', '1'],
    ['ch1.xhtml#page_2', '2'],
    ['ch1.xhtml#page_3', '3'],
    ['ch1.xhtml#page_4', '4'],
    ['ch2.xhtml#page_5', '5'],
    ['ch2.xhtml#page_6', '6'],
    ['ch2.xhtml#page_7', '7'],
  ];
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="pre.xhtml">Préface</a></li><li><a href="ch1.xhtml">Chapitre premier</a></li><li><a href="ch2.xhtml">Chapitre II</a></li></ol></nav>` +
      (pageList ? `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>` : ''),
  );
  return zipEpub(title, { 'pre.xhtml': pre, 'ch1.xhtml': ch1, 'ch2.xhtml': ch2 }, nav);
}

/** EPUB sans pages imprimées : 3 chapitres, ~60 000 signes. */
export async function epubPlain() {
  const chapters = {};
  for (let c = 1; c <= 3; c++) {
    let body = `<h1>Partie ${c}</h1>`;
    for (let k = 0; k < 18; k++) body += `<p>${para(`Partie ${c}, paragraphe ${k + 1} :`, 600 + ((k * 397 + c * 131) % 900), c * 31 + k)}</p>`;
    chapters[`p${c}.xhtml`] = xhtml(`Partie ${c}`, body);
  }
  const nav = xhtml('Sommaire', `<nav epub:type="toc"><ol>${Object.keys(chapters).map((f, i) => `<li><a href="${f}">Partie ${i + 1}</a></li>`).join('')}</ol></nav>`);
  return zipEpub('Traité sans pages', chapters, nav);
}

/** PDF de 5 pages dont la numérotation imprimée est i, ii, 1, 2, 3 (PageLabels). */
export function pdfWithLabels() {
  const n = 5;
  const objs = [];
  const pageIds = [];
  for (let i = 0; i < n; i++) pageIds.push(4 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  for (let i = 0; i < n; i++) {
    const label = ['i', 'ii', '1', '2', '3'][i];
    const text = `BT /F1 22 Tf 60 700 Td (Page physique ${i + 1}, imprimee ${label}) Tj ET BT /F1 12 Tf 60 660 Td (Texte de la page ${i + 1} pour le test des libelles.) Tj ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[5 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Importe un livre (Buffer) via le store, l'ouvre au besoin, renvoie son id. */
export async function importBuffer(page, name, buf, open = true) {
  const b64 = Buffer.from(buf).toString('base64');
  return page.evaluate(
    async ({ name, b64, open }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: true });
      if (open && book) window.__store.getState().openBook(book.id);
      return book?.id;
    },
    { name, b64, open },
  );
}
