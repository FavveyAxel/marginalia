// Palette de commandes ⌘K (façon Raycast / Linear).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  FileText,
  CornerDownLeft,
  FilePen,
  FolderPlus,
  Folder,
  Highlighter,
  Lightbulb,
  ListTree,
  Search,
  Sigma,
  SunMoon,
  Upload,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { host } from '../lib/platform';
import { CATEGORY_BY_ID } from '../lib/categories';
import { Kbd } from './ui';
import './command.css';

const norm = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const MAX = 6;
const MAX_EMPTY = 4;

interface Cmd {
  id: string;
  group: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
  dot?: string;
  hint?: string;
  /** Mots-clés de recherche (non affichés). */
  keywords?: string;
  haystack: string;
  run(): void;
}

const GROUPS = ['Actions', 'Livres', 'Écrits', 'Concepts', 'Extraits', 'Plans', 'Arguments', 'Fiches-texte', 'Espaces'];

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const { books, drafts, concepts, highlights, workspaces, plans, args, studies } = useStore(
    useShallow((s) => ({
      books: s.books,
      drafts: s.drafts,
      concepts: s.concepts,
      highlights: s.highlights,
      workspaces: s.workspaces,
      plans: s.plans,
      args: s.arguments,
      studies: s.studies,
    })),
  );
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardNav = useRef(false);

  const close = () => useStore.getState().setCommandOpen(false);

  const all = useMemo<Cmd[]>(() => {
    const st = () => useStore.getState();
    const nav = (route: Parameters<ReturnType<typeof st>['navigate']>[0]) => () => st().navigate(route);
    const act = (id: string, label: string, icon: ReactNode, run: () => void, extra: Partial<Cmd> = {}): Cmd => ({
      id: 'a-' + id,
      group: 'Actions',
      label,
      icon,
      haystack: norm(label + ' ' + (extra.keywords ?? '')),
      run,
      ...extra,
    });
    const actions: Cmd[] = [
      act(
        'import',
        'Importer…',
        <Upload size={15} />,
        async () => {
          const files = await host.pickFiles();
          if (!files.length) return;
          const added = await useStore.getState().importFiles(files);
          if (added.length === 1) useStore.getState().openBook(added[0].id);
        },
        { hint: '⌘O', keywords: 'ajouter epub pdf docx livre' },
      ),
      act('write', 'Nouvel écrit', <FilePen size={15} />, nav({ name: 'write', draftId: null }), { keywords: 'rédiger dissertation document' }),
      act('revision', 'Réviser', <Brain size={15} />, nav({ name: 'revision' }), { keywords: 'cartes révision' }),
      act('library', 'Bibliothèque', <BookOpen size={15} />, nav({ name: 'library' }), { keywords: 'livres' }),
      act('extracts', 'Extraits', <Highlighter size={15} />, nav({ name: 'extracts' }), { keywords: 'citations surlignages notes' }),
      act('concepts', 'Concepts', <Lightbulb size={15} />, nav({ name: 'concepts', conceptId: null }), { keywords: 'notions' }),
      act('arguments', 'Arguments', <Sigma size={15} />, nav({ name: 'arguments', argumentId: null }), { keywords: 'prémisses conclusion' }),
      act('plans', 'Plans', <ListTree size={15} />, nav({ name: 'plans', planId: null }), { keywords: 'dissertation plan' }),
      act(
        'theme',
        'Basculer clair / sombre',
        <SunMoon size={15} />,
        () => {
          const dark = document.documentElement.dataset.theme === 'dark';
          useStore.getState().updateSettings({ theme: dark ? 'light' : 'dark' });
        },
        { keywords: 'thème apparence mode' },
      ),
      act(
        'workspace',
        'Nouvel espace de travail',
        <FolderPlus size={15} />,
        () => {
          const ws = useStore.getState().createWorkspace('Nouvel espace');
          useStore.getState().navigate({ name: 'workspace', workspaceId: ws.id, groupId: null });
        },
        { keywords: 'groupe projet' },
      ),
    ];

    const bookTitle = new Map(books.map((b) => [b.id, b.title]));
    const conceptName = new Map(concepts.map((c) => [c.id, c.name]));

    const items: Cmd[] = [...actions];
    [...books]
      .sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
      .forEach((b) =>
        items.push({
          id: 'b-' + b.id,
          group: 'Livres',
          label: b.title,
          meta: b.author,
          icon: <BookOpen size={15} />,
          haystack: norm(b.title + ' ' + b.author),
          run: () => st().openBook(b.id),
        }),
      );
    [...drafts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((d) =>
        items.push({
          id: 'd-' + d.id,
          group: 'Écrits',
          label: d.title || 'Sans titre',
          meta: d.wordCount ? `${d.wordCount} mots` : undefined,
          icon: <FilePen size={15} />,
          haystack: norm(d.title),
          run: () => st().navigate({ name: 'write', draftId: d.id }),
        }),
      );
    [...concepts]
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .forEach((c) =>
        items.push({
          id: 'c-' + c.id,
          group: 'Concepts',
          label: c.name,
          meta: c.programme === 'notion' ? 'Notion' : c.programme === 'repere' ? 'Repère' : undefined,
          icon: <Lightbulb size={15} />,
          haystack: norm(c.name + ' ' + c.definition),
          run: () => st().navigate({ name: 'concepts', conceptId: c.id }),
        }),
      );
    [...highlights]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((h) =>
        items.push({
          id: 'h-' + h.id,
          group: 'Extraits',
          label: h.text.replace(/\s+/g, ' ').trim(),
          meta: bookTitle.get(h.bookId),
          dot: h.category ? `var(${CATEGORY_BY_ID[h.category].cssVar})` : 'var(--muted)',
          haystack: norm(h.text + ' ' + h.note + ' ' + h.conceptIds.map((id) => conceptName.get(id) ?? '').join(' ')),
          run: () => st().jumpToHighlight(h.id),
        }),
      );
    [...plans]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((p) =>
        items.push({
          id: 'p-' + p.id,
          group: 'Plans',
          label: p.sujet.trim() || p.title || 'Sans titre',
          icon: <ListTree size={15} />,
          haystack: norm([p.title, p.sujet, p.problematique].join(' ')),
          run: () => st().navigate({ name: 'plans', planId: p.id }),
        }),
      );
    [...args]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((a) =>
        items.push({
          id: 'r-' + a.id,
          group: 'Arguments',
          label: a.title || 'Sans titre',
          meta: a.bookId ? bookTitle.get(a.bookId) : undefined,
          icon: <Sigma size={15} />,
          haystack: norm([a.title, a.conclusion.text, ...a.premises.map((x) => x.text)].join(' ')),
          run: () => st().navigate({ name: 'arguments', argumentId: a.id }),
        }),
      );
    [...studies]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((x) =>
        items.push({
          id: 's-' + x.id,
          group: 'Fiches-texte',
          label: x.title || 'Fiche-texte',
          meta: bookTitle.get(x.bookId),
          icon: <FileText size={15} />,
          haystack: norm([x.title, x.probleme, x.these, bookTitle.get(x.bookId) ?? ''].join(' ')),
          run: () => {
            st().updateSettings({ rightPanel: 'etude', showExtracts: true });
            st().openBook(x.bookId);
          },
        }),
      );
    [...workspaces]
      .sort((a, b) => a.order - b.order)
      .forEach((w) =>
        items.push({
          id: 'w-' + w.id,
          group: 'Espaces',
          label: w.name,
          icon: <Folder size={15} />,
          dot: undefined,
          haystack: norm(w.name),
          run: () => st().navigate({ name: 'workspace', workspaceId: w.id, groupId: null }),
        }),
      );
    return items;
  }, [books, drafts, concepts, highlights, workspaces, plans, args, studies]);

  const results = useMemo(() => {
    const terms = norm(q.trim()).split(/\s+/).filter(Boolean);
    const out: Cmd[] = [];
    for (const g of GROUPS) {
      let list = all.filter((c) => c.group === g);
      if (terms.length) list = list.filter((c) => terms.every((t) => c.haystack.includes(t)));
      if (terms.length) {
        // Les correspondances en début de libellé d'abord
        const first = terms[0];
        list = [...list].sort((a, b) => Number(norm(b.label).startsWith(first)) - Number(norm(a.label).startsWith(first)));
      }
      // Sans requête : toutes les actions (c'est un menu), quelques éléments des autres groupes
      const cap = terms.length ? MAX : g === 'Actions' ? list.length : MAX_EMPTY;
      out.push(...list.slice(0, cap));
    }
    return out;
  }, [all, q]);

  useEffect(() => setFocus(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!keyboardNav.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    close();
    c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      keyboardNav.current = true;
      setFocus((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      keyboardNav.current = true;
      setFocus((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(focus);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  let lastGroup = '';
  return (
    <div className="cmd-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmd-modal" role="dialog" aria-label="Palette de commandes" onKeyDown={onKey}>
        <div className="cmd-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Rechercher un livre, un extrait, un plan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
            aria-label="Rechercher"
          />
          <Kbd>Échap</Kbd>
        </div>
        <div className="cmd-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <div className="cmd-none">
              Aucun résultat pour « {q.trim()} »
            </div>
          )}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="cmd-group">{head}</div>}
                <div
                  data-idx={i}
                  role="option"
                  aria-selected={i === focus}
                  className={`cmd-item ${i === focus ? 'focused' : ''}`}
                  onMouseMove={() => {
                    keyboardNav.current = false;
                    if (focus !== i) setFocus(i);
                  }}
                  onClick={() => runAt(i)}
                >
                  <span className="cmd-icon">{c.dot ? <span className="cat-dot" style={{ background: c.dot }} /> : c.icon}</span>
                  <span className={`cmd-label ${c.group === 'Extraits' ? 'is-quote' : ''}`}>{c.label}</span>
                  {c.meta && <span className="cmd-meta">{c.meta}</span>}
                  {c.hint && <Kbd>{c.hint}</Kbd>}
                  {i === focus && !c.hint && <CornerDownLeft size={13} className="cmd-enter" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmd-foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> naviguer
          </span>
          <span>
            <Kbd>↵</Kbd> ouvrir
          </span>
          <span>
            <Kbd>Échap</Kbd> fermer
          </span>
        </div>
      </div>
    </div>
  );
}
