// ─────────────────────────────────────────────────────────────
// Import de cartes de révision depuis un tableau : Excel (.xlsx) ou texte (.csv, .tsv, .txt).
// Colonnes reconnues par leur titre (1re ligne) : « Question » (ou Recto), « Réponse » (ou Verso),
// « Livre » (facultatif : titre d'un livre de la bibliothèque). Sans titres reconnus : colonne A =
// question, B = réponse, C = livre. Tout se lit sur l'ordinateur, rien ne part sur Internet.
// ─────────────────────────────────────────────────────────────
import JSZip from 'jszip';

export interface ImportedCard {
  front: string;
  back: string;
  /** Texte de la colonne Livre, tel qu'écrit (vide : aucun). */
  book: string;
  /** Numéro de ligne dans le fichier (1 = première ligne), pour les messages. */
  line: number;
}

export interface ParsedCards {
  cards: ImportedCard[];
  /** Lignes ignorées : question ou réponse vide. */
  incomplete: number[];
  /** La 1re ligne portait des titres de colonnes reconnus. */
  header: boolean;
}

/** Au-delà, le fichier n'est pas un jeu de cartes (ou n'a pas été choisi par erreur). */
export const MAX_IMPORT_ROWS = 5000;

const norm = (s: string) =>
  s
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const FRONT = /^(question|questions|recto|front|q|intitule|terme|notion)$/;
const BACK = /^(reponse|reponses|verso|back|answer|r|definition|explication)$/;
const BOOK = /^(livre|book|ouvrage|source|oeuvre)( facultatif)?$/;

/** Lignes du tableau → cartes. */
export function rowsToCards(rows: string[][]): ParsedCards {
  const first = (rows[0] ?? []).map((c) => norm(c));
  let fi = first.findIndex((c) => FRONT.test(c));
  let bi = first.findIndex((c) => BACK.test(c));
  let ki = first.findIndex((c) => BOOK.test(c));
  const header = fi >= 0 && bi >= 0;
  if (!header) {
    fi = 0;
    bi = 1;
    ki = 2;
  }
  const cards: ImportedCard[] = [];
  const incomplete: number[] = [];
  rows.forEach((r, i) => {
    if (header && i === 0) return;
    const cell = (k: number) => (k >= 0 ? (r[k] ?? '').replace(/\r\n?/g, '\n').trim() : '');
    const front = cell(fi);
    const back = cell(bi);
    if (!front && !back && !r.some((c) => c.trim())) return; // ligne vide : rien à signaler
    if (!front || !back) {
      incomplete.push(i + 1);
      return;
    }
    cards.push({ front, back, book: cell(ki), line: i + 1 });
  });
  return { cards, incomplete, header };
}

// ── CSV ──────────────────────────────────────────────────────

/** Texte d'un .csv : UTF-8, sinon Windows-1252 (ancien Excel en français). */
export function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    t = new TextDecoder('windows-1252').decode(bytes);
  }
  return t.replace(/^﻿/, '');
}

/** Séparateur le plus probable : celui qui découpe la 1re ligne (hors guillemets) le plus souvent. */
function guessDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  let best = ';';
  let bestN = 0;
  for (const d of [';', '\t', ',']) {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    if (n > bestN) (best = d), (bestN = n);
  }
  return best;
}

/** CSV (guillemets doublés, retours à la ligne dans une cellule entre guillemets). */
export function parseCsv(text: string, delimiter = guessDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delimiter) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows;
}

// ── Excel ────────────────────────────────────────────────────

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};
const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag));
const textOf = (el: Element) =>
  byTag(el, 't')
    .filter((t) => !t.closest('rPh')) // pas les lectures phonétiques (japonais)
    .map((t) => t.textContent ?? '')
    .join('');

/** Première feuille d'un classeur .xlsx → lignes de texte. */
export async function parseXlsx(data: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(data);
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? null;
  // Première feuille dans l'ordre du classeur (pas forcément sheet1.xml).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sheet = byTag(xml(wb), 'sheet')[0];
    const rid = sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? sheet?.getAttribute('r:id');
    const target = byTag(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error('Feuille introuvable dans le classeur');
  const sst = await read('xl/sharedStrings.xml');
  const shared = sst ? byTag(xml(sst), 'si').map(textOf) : [];
  const rows: string[][] = [];
  for (const r of byTag(xml(sheetXml), 'row')) {
    const idx = Number(r.getAttribute('r') ?? rows.length + 1) - 1;
    if (idx >= MAX_IMPORT_ROWS + 1) break;
    const row: string[] = [];
    for (const c of byTag(r, 'c')) {
      const k = c.getAttribute('r') ? colIndex(c.getAttribute('r')!) : row.length;
      if (k > 50) continue;
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = byTag(c, 'is')[0] ? textOf(byTag(c, 'is')[0]) : '';
      else if (t === 'b') val = v === '1' ? 'VRAI' : 'FAUX';
      else val = v;
      while (row.length < k) row.push('');
      row[k] = val;
    }
    while (rows.length < idx) rows.push([]);
    rows[idx] = row;
  }
  return rows;
}

/** Fichier choisi → cartes. Lève une erreur lisible si le format n'est pas pris en charge. */
export async function parseCardFile(name: string, data: ArrayBuffer): Promise<ParsedCards> {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  let rows: string[][];
  if (ext === 'xlsx') rows = await parseXlsx(data);
  else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') rows = parseCsv(decodeText(data), ext === 'tsv' ? '\t' : undefined);
  else if (ext === 'xls' || ext === 'numbers' || ext === 'ods') throw new Error('Enregistrez le tableau au format Excel (.xlsx) ou .csv, puis importez-le.');
  else throw new Error('Format non pris en charge : choisissez un fichier Excel (.xlsx) ou .csv.');
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Fichier trop long : ${MAX_IMPORT_ROWS} cartes au plus par import.`);
  return rowsToCards(rows);
}

// ── Modèle à remplir ─────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const TEMPLATE_ROWS: string[][] = [
  ['Question', 'Réponse', 'Livre (facultatif)'],
  ['Qu’est-ce que l’impératif catégorique ?', 'Un commandement moral inconditionnel : « Agis uniquement d’après la maxime qui fait que tu puisses vouloir en même temps qu’elle devienne une loi universelle. »', 'Fondements de la métaphysique des mœurs'],
  ['Pourquoi la fausse promesse est-elle contradictoire ?', 'Universalisée, elle détruirait la confiance qui rend toute promesse possible.', ''],
];

/** Modèle .xlsx (une feuille « Cartes », titres en gras, colonnes larges, texte renvoyé à la ligne). */
export async function templateXlsx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cartes" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  );
  const cols = ['A', 'B', 'C'];
  const rowsXml = TEMPLATE_ROWS.map(
    (r, i) =>
      `<row r="${i + 1}">${r
        .map((v, j) => `<c r="${cols[j]}${i + 1}" t="inlineStr" s="${i === 0 ? 1 : 2}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)
        .join('')}</row>`,
  ).join('');
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="50" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/><col min="3" max="3" width="36" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}
