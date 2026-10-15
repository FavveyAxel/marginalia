// Polices fournies avec Marginalia (Literata, Instrument Serif, Caveat), incluses dans les exports
// PDF et HTML quand le document les emploie : la fenêtre d'impression (sans réseau, data: seulement)
// et une page web ouverte sur un autre ordinateur ne les trouveraient pas sinon. Seules les familles
// réellement utilisées sont embarquées (≈ 40 à 200 Ko chacune), en data: (woff2).
import literataLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import literataLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url';
import literataLatinIt from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url';
import literataLatinExtIt from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url';
import instrumentLatin from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url';
import instrumentLatinExt from '@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2?url';
import instrumentLatinIt from '@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2?url';
import instrumentLatinExtIt from '@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-italic.woff2?url';
import caveat400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url';
import caveat400Ext from '@fontsource/caveat/files/caveat-latin-ext-400-normal.woff2?url';
import caveat600 from '@fontsource/caveat/files/caveat-latin-600-normal.woff2?url';
import caveat600Ext from '@fontsource/caveat/files/caveat-latin-ext-600-normal.woff2?url';

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

interface Face {
  url: string;
  style: 'normal' | 'italic';
  weight: string;
  range: string;
}
/** Familles fournies, par nom normalisé (nom Word → fichiers). */
const BUNDLED: Record<string, Face[]> = {
  literata: [
    { url: literataLatin, style: 'normal', weight: '200 900', range: LATIN },
    { url: literataLatinExt, style: 'normal', weight: '200 900', range: LATIN_EXT },
    { url: literataLatinIt, style: 'italic', weight: '200 900', range: LATIN },
    { url: literataLatinExtIt, style: 'italic', weight: '200 900', range: LATIN_EXT },
  ],
  'instrument serif': [
    { url: instrumentLatin, style: 'normal', weight: '400', range: LATIN },
    { url: instrumentLatinExt, style: 'normal', weight: '400', range: LATIN_EXT },
    { url: instrumentLatinIt, style: 'italic', weight: '400', range: LATIN },
    { url: instrumentLatinExtIt, style: 'italic', weight: '400', range: LATIN_EXT },
  ],
  caveat: [
    { url: caveat400, style: 'normal', weight: '400', range: LATIN },
    { url: caveat400Ext, style: 'normal', weight: '400', range: LATIN_EXT },
    { url: caveat600, style: 'normal', weight: '600', range: LATIN },
    { url: caveat600Ext, style: 'normal', weight: '600', range: LATIN_EXT },
  ],
};

const norm = (f: string) => f.trim().toLowerCase().replace(/\s+variable$/, '').replace(/\s+/g, ' ');

/** Cette police est-elle fournie avec l'app ? */
export function isBundledFont(family: string): boolean {
  return norm(family) in BUNDLED;
}

const cache = new Map<string, Promise<string>>();
async function dataUrl(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `data:font/woff2;base64,${btoa(bin)}`;
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/**
 * Règles @font-face (data:) des polices fournies parmi `families`, sous le nom employé par le
 * document. Chaîne vide si aucune ; une police illisible est ignorée (le repli CSS s'applique).
 */
export async function bundledFontFaceCss(families: Iterable<string>): Promise<string> {
  const out: string[] = [];
  const done = new Set<string>();
  for (const fam of families) {
    const key = norm(fam);
    const faces = BUNDLED[key];
    const name = fam.replace(/['"\\<>;{}]/g, '').trim();
    if (!faces || done.has(name.toLowerCase())) continue;
    done.add(name.toLowerCase());
    for (const f of faces) {
      try {
        const src = await dataUrl(f.url);
        out.push(`@font-face { font-family: '${name}'; font-style: ${f.style}; font-weight: ${f.weight}; font-display: block; src: url(${src}) format('woff2'); unicode-range: ${f.range}; }`);
      } catch (e) {
        console.warn('police non incluse', fam, e);
      }
    }
  }
  return out.join('\n');
}
