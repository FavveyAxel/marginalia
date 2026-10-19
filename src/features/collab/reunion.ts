// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : RÉUNION, quand on rejoint un espace qu'on a déjà (même shareId) après avoir
// travaillé chacun de son côté. Rien ne se perd, rien n'est mélangé lettre à lettre.
//
//  1. Avant tout : une version de chaque écrit de l'espace, « Avant la reconnexion avec Léa ».
//  2. Éléments (records.ts), en fusion à trois avec la base gardée à la fin de la dernière session
//     (memory.ts) : changé d'un seul côté → ce côté ; des deux côtés → champ par champ : texte changé
//     des deux côtés → CHOIX (« Garder la mienne », « Garder celle de Léa », « Garder les deux ») ;
//     position et autres réglages → la dernière modification gagne ; supprimé d'un côté et modifié de
//     l'autre → gardé, avec un message.
//  3. Écrits : fusion à trois paragraphe par paragraphe (docxMerge.ts) ; paragraphe changé des deux
//     côtés → même choix. Le résultat est enregistré ici et envoyé aux autres, qui en gardent eux aussi
//     une version d'avant (« Avant la reconnexion avec Marc »).
// ─────────────────────────────────────────────────────────────
import { host } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { openSharePackage, shareableDocx } from '../share/sharePackage';
import { addVersionFromLibrary } from '../editor/versions';
import { buildMerged, merge3, parseDocxBlocks, type Choice, type Chunk } from './docxMerge';
import { knownMtimes, loadMemory } from './memory';
import { keyOf, type Col, type Rec, type RecordSync } from './records';
import { useCollab } from './collabState';

export { rememberSession } from './memory';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ReuniteInput {
  records: RecordSync;
  shareId: string;
  hostRecs: Rec[];
  hostMtimes: Record<string, number>;
  pkg: Uint8Array;
  hostName: string;
}
export interface ReuniteResult {
  /** Mes enregistrements à envoyer à tous après la réunion. */
  mine: Rec[];
  /** Écrits réunis à envoyer : gid → .docx (sans notes privées). */
  docx: { g: string; data: ArrayBuffer; words: number }[];
  messages: string[];
}

/** Un choix demandé à l'utilisateur. */
export interface ReunionItem {
  id: string;
  kind: 'paragraph' | 'record';
  /** « Le parjure », « Carte « Promesse » »… */
  where: string;
  mine: string;
  theirs: string;
}

const TEXT: Partial<Record<Col, string[]>> = {
  ws: ['name'],
  group: ['name'],
  node: ['text'],
  edge: ['note'],
  highlight: ['note', 'text'],
  concept: ['name', 'definition'],
  map: ['title'],
  draft: ['title'],
  plan: ['title', 'sujet', 'definitions', 'problematique', 'conclusion'],
  argument: ['title', 'comment'],
  study: ['title', 'probleme', 'these', 'enjeu'],
  book: ['title', 'author'],
};
const J = (v: unknown) => JSON.stringify(v ?? null);

/** Demande les choix à l'utilisateur (fenêtre « Réunir », CollabHost.tsx). */
function ask(items: ReunionItem[], hostName: string): Promise<Record<string, Choice>> {
  if (!items.length) return Promise.resolve({});
  return new Promise((resolve) => useCollab.setState({ reunion: { hostName, items, resolve: (c: Record<string, Choice>) => (useCollab.setState({ reunion: null }), resolve(c)) } }));
}

function label(c: Col, d: Any | undefined, st = useStore.getState()): string {
  if (!d) return 'Élément';
  if (c === 'node') return `Carte « ${String(d.text || 'sans texte').slice(0, 40)} »`;
  if (c === 'highlight') return `Extrait « ${String(d.text ?? '').slice(0, 40)} »`;
  if (c === 'map') return `Carte « ${d.title ?? 'sans titre'} »`;
  if (c === 'concept') return `Concept « ${d.name} »`;
  if (c === 'group') return `Groupe « ${d.name} »`;
  void st;
  return String(d.title ?? d.name ?? 'Élément');
}

export async function reunite(i: ReuniteInput): Promise<ReuniteResult> {
  const { records, hostName } = i;
  const st0 = useStore.getState();
  const mem = await loadMemory(i.shareId);
  const myMtimes = { ...(await knownMtimes(i.shareId)), ...Object.fromEntries(records.mtimes) };
  const messages: string[] = [];

  // ── 1. Une version de chaque écrit, avant tout ──
  const mine = records.snapshot();
  const myDrafts = [...mine.values()].filter((v) => v.c === 'draft');
  for (const v of myDrafts) await addVersionFromLibrary(v.id, { kind: 'manual', name: `Avant la reconnexion avec ${hostName}`, force: true }).catch((e) => console.warn('version', e));

  // ── 2. Éléments ──
  const theirs = new Map(i.hostRecs.filter((r) => !r.del).map((r) => [keyOf(r.c, r.g), r]));
  const base = mem?.records ?? {};
  const keys = new Set([...mine.keys(), ...theirs.keys(), ...Object.keys(base)]);
  const applyTheirs: Rec[] = [];
  const sendMine: Rec[] = [];
  type Pending = { k: string; c: Col; g: string; merged: Any; fields: { f: string; mine: string; theirs: string; id: string }[]; tag: Rec['tag'] };
  const pending: Pending[] = [];
  const items: ReunionItem[] = [];
  for (const k of keys) {
    if (records.privateKeys.has(k)) continue;
    const [c, ...rest] = k.split(':') as [Col, ...string[]];
    const g = rest.join(':');
    if (c === 'book') continue; // un livre ne se fusionne pas (même fichier) ; ses métadonnées suivent la dernière modification ci-dessous
    const m = mine.get(k)?.d;
    const t = theirs.get(k)?.d as Any | undefined;
    const tag = theirs.get(k)?.tag ?? ([0, 'h'] as Rec['tag']);
    const bj = base[k];
    const b = bj ? (JSON.parse(bj) as Any) : undefined;
    const mj = m ? J(m) : undefined;
    const tj = t ? J(t) : undefined;
    if (mj === tj) continue;
    if (tj === bj) {
      // Changé ici seulement (ou créé, ou supprimé ici).
      sendMine.push(m ? { c, g, d: m, tag } : { c, g, del: 1, tag });
      continue;
    }
    if (mj === bj) {
      applyTheirs.push(t ? { c, g, d: t, tag } : { c, g, del: 1, tag });
      continue;
    }
    // Changé des deux côtés.
    if (!m && t) {
      applyTheirs.push({ c, g, d: t, tag });
      messages.push(`${label(c, t)} : supprimé chez vous, modifié par ${hostName} — gardé.`);
      continue;
    }
    if (m && !t) {
      sendMine.push({ c, g, d: m, tag });
      messages.push(`${label(c, m)} : supprimé par ${hostName}, modifié chez vous — gardé.`);
      continue;
    }
    // Champ par champ.
    const merged: Any = { ...t };
    const fields: Pending['fields'] = [];
    const texts = TEXT[c] ?? [];
    const latestMine = (myMtimes[k] ?? 0) > (i.hostMtimes[k] ?? 0);
    for (const f of new Set([...Object.keys(m!), ...Object.keys(t!)])) {
      const mv = J(m![f]);
      const tv = J(t![f]);
      const bv = J(b?.[f]);
      if (mv === tv) continue;
      if (tv === bv) merged[f] = m![f];
      else if (mv === bv) merged[f] = t![f];
      else if (texts.includes(f) && typeof m![f] === 'string' && typeof t![f] === 'string') {
        const id = `${k}#${f}`;
        fields.push({ f, mine: m![f], theirs: t![f], id });
        items.push({ id, kind: 'record', where: label(c, b ?? m), mine: m![f], theirs: t![f] });
      } else merged[f] = latestMine ? m![f] : t![f]; // position, couleur, réglages : la dernière gagne
    }
    pending.push({ k, c, g, merged, fields, tag });
  }

  // ── 3. Écrits, paragraphe par paragraphe ──
  const pkg = await openSharePackage(i.pkg);
  const hostDraft = new Map<string, { data: Uint8Array; title: string }>();
  for (const d of pkg.data.drafts) {
    const g = (d.shareOrigin?.srcId ?? d.id) as string;
    const f = pkg.files.get(`files/${d.id}/${d.fileName}`);
    if (f) hostDraft.set(g, { data: f, title: d.title });
  }
  type DraftWork = { g: string; localId: string; title: string; chunks: Chunk[]; container: Awaited<ReturnType<typeof parseDocxBlocks>>; theirsData: Uint8Array; conflictIds: string[] };
  const drafts: DraftWork[] = [];
  for (const v of myDrafts) {
    const theirsD = hostDraft.get(v.g);
    if (!theirsD) continue;
    const d = st0.drafts.find((x) => x.id === v.id);
    if (!d) continue;
    const myData = await host.readFile(d.id, d.fileName);
    let container, theirsP;
    try {
      container = await parseDocxBlocks(myData);
      theirsP = await parseDocxBlocks(theirsD.data);
    } catch (e) {
      console.warn('collab : écrit illisible pour la réunion', e);
      continue;
    }
    if (J(container.blocks.map((b) => b.text)) === J(theirsP.blocks.map((b) => b.text))) continue;
    const chunks = merge3(mem?.drafts[v.g] ?? null, container.blocks, theirsP.blocks);
    const conflictIds: string[] = [];
    let n = 0;
    for (const ch of chunks) {
      if (ch.kind !== 'conflict') continue;
      const id = `draft:${v.g}#${n++}`;
      conflictIds.push(id);
      items.push({ id, kind: 'paragraph', where: `« ${d.title} »`, mine: ch.mine.map((b) => b.text).join('\n\n'), theirs: ch.theirs.map((b) => b.text).join('\n\n') });
    }
    drafts.push({ g: v.g, localId: d.id, title: d.title, chunks, container, theirsData: theirsD.data, conflictIds });
  }

  // ── 4. Les choix ──
  const choices = await ask(items, hostName);
  const pick = (id: string): Choice => choices[id] ?? 'both';

  for (const p of pending) {
    let extra: Rec | null = null;
    for (const f of p.fields) {
      const ch = pick(f.id);
      if (ch === 'mine') p.merged[f.f] = f.mine;
      else if (ch === 'theirs') p.merged[f.f] = f.theirs;
      else if (p.c === 'node' && f.f === 'text') {
        // « Garder les deux » sur une carte : la mienne reste, la leur devient une carte à côté.
        p.merged[f.f] = f.mine;
        const at = p.g.lastIndexOf('§');
        const newG = `${p.g.slice(0, at)}§${p.g.slice(at + 1)}-${hostName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'autre'}`;
        extra = { c: 'node', g: newG, d: { ...p.merged, text: f.theirs, x: Number(p.merged.x ?? 0) + 40, y: Number(p.merged.y ?? 0) + 60 }, tag: p.tag };
      } else p.merged[f.f] = `${f.mine}\n\n— ${hostName} —\n${f.theirs}`;
    }
    const rec: Rec = { c: p.c, g: p.g, d: p.merged, tag: p.tag };
    applyTheirs.push(rec);
    sendMine.push(rec);
    if (extra) {
      applyTheirs.push(extra);
      sendMine.push(extra);
    }
  }
  records.force(applyTheirs, 'h');

  const outDocx: ReuniteResult['docx'] = [];
  for (const w of drafts) {
    const cs = w.conflictIds.map(pick);
    const merged = await buildMerged(w.container, w.chunks, cs);
    const d = useStore.getState().drafts.find((x) => x.id === w.localId);
    if (!d) continue;
    if (!merged) {
      // Un bloc renvoie à une image ou une note absente d'ici : on garde l'écrit de l'hôte ; le mien est dans les versions.
      await host.storeFile(d.id, d.fileName, w.theirsData.slice().buffer as ArrayBuffer);
      messages.push(`« ${w.title} » : réunion paragraphe par paragraphe impossible (images ou notes) — la version de ${hostName} est gardée, la vôtre est dans les versions.`);
      continue;
    }
    await host.storeFile(d.id, d.fileName, merged);
    const sameAsTheirs = J((await parseDocxBlocks(merged)).blocks.map((b) => b.text)) === J((await parseDocxBlocks(w.theirsData)).blocks.map((b) => b.text));
    const words = (await parseDocxBlocks(merged)).blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
    useStore.getState().applyExternal((s) => ({ drafts: s.drafts.map((x) => (x.id === d.id ? { ...x, wordCount: words } : x)) }));
    if (!sameAsTheirs) outDocx.push({ g: w.g, data: (await shareableDocx(merged)).data, words });
  }
  return { mine: records.stamp(sendMine), docx: outDocx, messages };
}
