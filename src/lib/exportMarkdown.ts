// Export Markdown compatible Obsidian : front matter YAML, callouts, [[wikilinks]].
import type { Book, Concept, Database, Highlight, MapEdge, MapNode, TextStudy } from './types';
import { CATEGORIES, NOTE_KIND_BY_ID, RELATION_BY_ID, kindLabel as extractLabel, kindOf } from './categories';

// ── Utilitaires ──────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

/** Chaîne YAML entre guillemets doubles (JSON est un sous-ensemble valide de YAML). */
const yq = (s: string) => JSON.stringify(s ?? '');

/** Nom sûr pour un [[wikilink]] Obsidian (caractères interdits dans un nom de note). */
function linkName(s: string): string {
  return (s || 'Sans titre').replace(/[\[\]#^|\\/:*?"<>]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sans titre';
}
const wikilink = (s: string) => `[[${linkName(s)}]]`;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function truncate(s: string, n: number): string {
  const t = oneLine(s);
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** Préfixe chaque ligne par `> ` (corps d'un callout). */
function quoteBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n');
}

function editionString(b: Book): string {
  const e = b.edition;
  return [e.translator ? `trad. ${e.translator}` : '', e.place, e.publisher, e.year].filter(Boolean).join(', ');
}

function frontMatter(fields: [string, string][], tags: string[]): string {
  const lines = ['---', ...fields.map(([k, v]) => `${k}: ${v}`), `tags: [${tags.join(', ')}]`, '---'];
  return lines.join('\n');
}

/** Ordre de lecture : HTML (chapitre puis début), PDF (page puis y). */
function textOrder(a: Highlight, b: Highlight): number {
  const key = (h: Highlight): [number, number, number] => {
    if (h.anchor.kind === 'html') return [0, h.anchor.chapter, h.anchor.start];
    const y = h.anchor.rects.length ? Math.min(...h.anchor.rects.map((r) => r.y)) : 0;
    const x = h.anchor.rects.length ? Math.min(...h.anchor.rects.map((r) => r.x)) : 0;
    return [0, h.anchor.page, y * 10 + x / 1000];
  };
  const ka = key(a);
  const kb = key(b);
  return ka[1] - kb[1] || ka[2] - kb[2] || a.createdAt - b.createdAt;
}

function headerParts(h: Highlight, label: string): string {
  const parts: string[] = [label];
  if (h.locationLabel) parts.push(h.locationLabel);
  const printed = h.printedPage.trim();
  if (printed) {
    const p = `p. ${printed}`;
    if (!parts.includes(p)) parts.push(p);
  }
  return parts.join(' · ');
}

function conceptNames(h: Highlight, db: Database): string[] {
  return h.conceptIds.map((id) => db.concepts.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
}

function calloutFor(h: Highlight, db: Database): string {
  const margin = kindOf(h) === 'note';
  const label = extractLabel(h);
  const kind = margin ? 'note' : 'quote';
  const lines: string[] = [`> [!${kind}] ${headerParts(h, label)}`];
  const text = h.text.trim();
  if (text) lines.push(quoteBlock(text));
  const note = h.note.trim();
  if (note) {
    if (text) lines.push('>');
    const kindLabel = h.noteKind ? NOTE_KIND_BY_ID[h.noteKind].label : '';
    lines.push(quoteBlock(`**Ma voix${kindLabel ? ` · ${kindLabel}` : ''}** — ${note}`));
  }
  const names = conceptNames(h, db);
  if (names.length) {
    lines.push('>');
    lines.push(`> Concepts : ${names.map(wikilink).join(', ')}`);
  }
  return lines.join('\n');
}

function nodeLabel(n: MapNode, db: Database): string {
  const h = n.highlightId ? db.highlights.find((x) => x.id === n.highlightId) : null;
  const t = n.text.trim() || h?.text || '(nœud vide)';
  return `« ${truncate(t, 140)} »`;
}

function studySection(s: TextStudy): string {
  const out: string[] = [`### ${s.title || 'Fiche-texte'}`, ''];
  if (s.probleme.trim()) out.push(`**Problème.** ${s.probleme.trim()}`, '');
  if (s.these.trim()) out.push(`**Thèse.** ${s.these.trim()}`, '');
  if (s.enjeu.trim()) out.push(`**Enjeu.** ${s.enjeu.trim()}`, '');
  if (s.movements.length) {
    out.push('**Mouvements**', '');
    s.movements.forEach((m, i) => {
      const bits = [m.title.trim() || `Mouvement ${i + 1}`];
      if (m.role.trim()) bits.push(m.role.trim());
      const start = m.startText.trim() ? ` (« ${truncate(m.startText, 80)} »)` : '';
      out.push(`${i + 1}. ${bits.join(' — ')}${start}`);
    });
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function mapSection(bookId: string, db: Database): string {
  const map = db.maps[bookId];
  if (!map || !map.edges.length) return '';
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  const done = new Set<string>();
  for (const e of map.edges) {
    if (done.has(e.id)) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    // Lien neutre : « est lié à » (le libellé court « lien » ne se lit pas entre deux cartes).
    const rel = e.relation === 'lien' ? 'est lié à' : (RELATION_BY_ID[e.relation]?.label ?? e.relation);
    let group: MapEdge[] = [e];
    if (e.groupId) group = map.edges.filter((x) => x.groupId === e.groupId && x.target === e.target && x.relation === e.relation);
    group.forEach((g) => done.add(g.id));
    const sources = group.map((g) => byId.get(g.source)).filter((n): n is MapNode => !!n);
    if (sources.length > 1) {
      lines.push(`- ${sources.map((n) => nodeLabel(n, db)).join(' + ')} (co-prémisses) **${rel}** ${nodeLabel(t, db)}`);
    } else {
      lines.push(`- ${nodeLabel(s, db)} **${rel}** ${nodeLabel(t, db)}`);
    }
  }
  return lines.length ? lines.join('\n') : '';
}

function argumentsSection(bookId: string, db: Database): string {
  const list = db.arguments.filter((a) => a.bookId === bookId);
  if (!list.length) return '';
  return list
    .map((a) => {
      const out: string[] = [`### ${a.title || 'Argument'}`, ''];
      a.premises.forEach((p, i) => out.push(`- **P${i + 1}.** ${p.text.trim() || '…'}${p.implicit ? ' *(prémisse implicite)*' : ''}`));
      out.push(`- **⇒ C.** ${a.conclusion.text.trim() || '…'}`);
      if (a.comment.trim()) out.push('', a.comment.trim());
      return out.join('\n');
    })
    .join('\n\n');
}

// ── Livre ────────────────────────────────────────────────────
export function bookToMarkdown(bookId: string, db: Database): string {
  const book = db.books.find((b) => b.id === bookId);
  if (!book) return '';
  const hs = db.highlights.filter((h) => h.bookId === bookId).sort(textOrder);
  const edition = editionString(book);

  const out: string[] = [];
  out.push(
    frontMatter(
      [
        ['title', yq(book.title)],
        ['author', yq(book.author)],
        ['edition', yq(edition)],
        ['exported', today()],
      ],
      ['marginalia'],
    ),
  );
  out.push('');
  out.push(`# ${book.title}`);
  const sub = [book.author, edition].filter(Boolean).join(' · ');
  if (sub) out.push('', `*${sub}*`);
  out.push('');

  out.push('## Extraits', '');
  if (!hs.length) out.push('*Aucun extrait.*', '');
  for (const h of hs) out.push(calloutFor(h, db), '');

  const studies = db.studies.filter((s) => s.bookId === bookId);
  if (studies.length) {
    out.push('## Fiches-texte', '');
    out.push(studies.map(studySection).join('\n\n'), '');
  }

  const map = mapSection(bookId, db);
  if (map) out.push('## Carte d’argument', '', map, '');

  const args = argumentsSection(bookId, db);
  if (args) out.push('## Arguments reconstruits', '', args, '');

  out.push('## Récapitulatif par catégorie', '');
  for (const c of CATEGORIES) {
    const n = hs.filter((h) => h.category === c.id).length;
    out.push(`- ${c.label} : ${n}`);
  }
  const plains = hs.filter((h) => kindOf(h) === 'plain').length;
  if (plains) out.push(`- Surlignages : ${plains}`);
  const margins = hs.filter((h) => kindOf(h) === 'note').length;
  out.push(`- Notes de marge : ${margins}`);
  out.push(`- Total : ${hs.length}`, '');

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ── Concepts ─────────────────────────────────────────────────
const LINK_PHRASE: Record<string, string> = {
  distingue: 'Se distingue de',
  oppose: 'S’oppose à',
  proche: 'Proche de',
};

function conceptBody(c: Concept, db: Database, level: 1 | 2): string {
  const h1 = '#'.repeat(level);
  const h2 = '#'.repeat(level + 1);
  const h3 = '#'.repeat(level + 2);
  const bookOf = (id: string | null) => (id ? db.books.find((b) => b.id === id) : undefined);
  const out: string[] = [`${h1} ${c.name}`, ''];
  if (c.programme) out.push(c.programme === 'notion' ? '*Notion du programme*' : '*Repère du programme*', '');
  if (c.definition.trim()) out.push(c.definition.trim(), '');

  if (c.senses.length) {
    out.push(`${h2} Sens par auteur`, '');
    for (const s of c.senses) {
      const book = bookOf(s.bookId);
      out.push(`${h3} ${s.author.trim() || book?.author || 'Auteur non précisé'}${book ? ` — ${wikilink(book.title)}` : ''}`, '');
      if (s.definition.trim()) out.push(s.definition.trim(), '');
    }
  }

  if (c.links.length) {
    out.push(`${h2} Distinctions`, '');
    for (const l of c.links) {
      const other = db.concepts.find((x) => x.id === l.conceptId);
      if (!other) continue;
      out.push(`- ${LINK_PHRASE[l.kind] ?? l.kind} ${wikilink(other.name)}${l.note.trim() ? ` — ${oneLine(l.note)}` : ''}`);
    }
    out.push('');
  }

  const ids = new Set<string>(c.senses.flatMap((s) => s.highlightIds));
  for (const h of db.highlights) if (h.conceptIds.includes(c.id)) ids.add(h.id);
  const linked = db.highlights.filter((h) => ids.has(h.id));
  if (linked.length) {
    out.push(`${h2} Extraits liés`, '');
    const sorted = [...linked].sort((a, b) => {
      const ba = bookOf(a.bookId)?.title ?? '';
      const bb = bookOf(b.bookId)?.title ?? '';
      return ba.localeCompare(bb, 'fr') || textOrder(a, b);
    });
    for (const h of sorted) {
      const book = bookOf(h.bookId);
      const loc = h.printedPage.trim() ? `p. ${h.printedPage.trim()}` : h.locationLabel;
      const cat = extractLabel(h);
      const title = [book ? wikilink(book.title) : '', loc, cat].filter(Boolean).join(' · ');
      const lines = [`> [!quote] ${title}`];
      if (h.text.trim()) lines.push(quoteBlock(h.text));
      if (h.note.trim()) {
        lines.push('>');
        lines.push(quoteBlock(`**Ma voix${h.noteKind ? ` · ${NOTE_KIND_BY_ID[h.noteKind].label}` : ''}** — ${h.note.trim()}`));
      }
      out.push(lines.join('\n'), '');
    }
  }
  return out.join('\n').trimEnd();
}

export function conceptToMarkdown(conceptId: string, db: Database): string {
  const c = db.concepts.find((x) => x.id === conceptId);
  if (!c) return '';
  const fm = frontMatter([['title', yq(c.name)], ['exported', today()]], ['marginalia', 'concept']);
  return `${fm}\n\n${conceptBody(c, db, 1)}\n`.replace(/\n{3,}/g, '\n\n');
}

export function conceptsToMarkdown(db: Database): string {
  const concepts = [...db.concepts].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const fm = frontMatter([['title', yq('Concepts')], ['exported', today()]], ['marginalia', 'concept']);
  const out: string[] = [fm, '', '# Concepts', ''];
  if (!concepts.length) out.push('*Aucun concept.*', '');
  for (const c of concepts) out.push(conceptBody(c, db, 2), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
