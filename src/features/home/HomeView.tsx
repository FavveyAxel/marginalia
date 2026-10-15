// Accueil : reprise de la lecture, révision du jour, espaces, derniers extraits, raccourcis.
// Premier lancement (aucun livre) : accueil d'embarquement en trois cartes.
import { useMemo, useState } from 'react';
import { BookOpen, Brain, FilePen, Lightbulb, ListTree, Plus, Search, Upload, FolderKanban } from 'lucide-react';
import { useStore, uid } from '../../lib/store';
import { host } from '../../lib/platform';
import type { EssayPlan } from '../../lib/types';
import { kindColor, kindLabel, kindOf } from '../../lib/categories';
import { Kbd, relativeTime } from '../../components/ui';
import { BookCover } from '../library/BookCover';
import { createDraft } from '../editor/api';
import { useDueCount } from '../revision/useDueCount';
import { InlineName } from '../workspaces/wsUi';
import { goToWorkspace, useResolvedItems, useWorkspaces } from '../workspaces/wsModel';
import './home.css';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const fraction = (p: number) => Math.max(0, Math.min(1, !p ? 0 : p > 1 ? p / 100 : p));

function greeting(now = new Date()) {
  const h = now.getHours();
  return h >= 18 || h < 4 ? 'Bonsoir' : 'Bonjour';
}

async function importFirst() {
  const files = await host.pickFiles();
  if (!files.length) return;
  const books = await useStore.getState().importFiles(files);
  if (books.length === 1) useStore.getState().openBook(books[0].id);
}

async function newDraft() {
  try {
    const d = await createDraft({ title: 'Sans titre', template: 'vide' });
    useStore.getState().navigate({ name: 'write', draftId: d.id });
  } catch (e) {
    console.error(e);
    useStore.getState().toast('Impossible de créer l’écrit', 'error');
  }
}

function newPlan() {
  const now = Date.now();
  const p: EssayPlan = { id: uid(), title: 'Nouveau plan', sujet: '', definitions: '', problematique: '', parts: [], conclusion: '', draftId: null, createdAt: now, updatedAt: now };
  useStore.getState().insert('plans', p);
  useStore.getState().navigate({ name: 'plans', planId: p.id });
}

function createAndOpenWorkspace(name: string) {
  const w = useStore.getState().createWorkspace(name);
  goToWorkspace(w.id, null);
}

export function HomeView() {
  const books = useStore((s) => s.books);
  const nBooks = books.length;
  const first = nBooks === 0;
  const now = new Date();
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="home-view anim-view">
      <header className="topbar">
        <span className="spacer" />
      </header>
      <div className="home-scroll">
        <div className="home-page">
          <div className="home-hello">
            <h1 className="page-title">{first ? 'Bienvenue dans Marginalia.' : `${greeting(now)}.`}</h1>
            <p className="muted">{first ? 'Lisez, annotez, puis écrivez. Commençons par un texte.' : date.charAt(0).toUpperCase() + date.slice(1)}</p>
          </div>
          {first ? <Onboarding /> : <Dashboard />}
          <Spaces compact={first} />
          {!first && <Recent />}
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}

// ── Premier lancement ──────────────────────────────────────

function Onboarding() {
  const navigate = useStore((s) => s.navigate);
  const [creating, setCreating] = useState(false);
  return (
    <section className="home-onboard anim-stagger" aria-label="Pour commencer">
      <article className="home-card home-step lift" style={{ ['--i' as string]: 0 }}>
        <span className="home-step-ico">
          <Upload size={18} />
        </span>
        <h3>Importer un premier texte</h3>
        <p>EPUB, PDF, Word, Markdown, TXT ou HTML. Vous pouvez aussi glisser un fichier dans la fenêtre.</p>
        <button className="btn btn-primary" onClick={() => void importFirst()}>
          Importer un texte <Kbd>⌘O</Kbd>
        </button>
      </article>
      <article className="home-card home-step lift" style={{ ['--i' as string]: 1 }}>
        <span className="home-step-ico">
          <FolderKanban size={18} />
        </span>
        <h3>Créer un espace de travail</h3>
        <p>Un espace réunit les textes, notes et écrits d’un même travail : un cours, un mémoire, une notion.</p>
        {creating ? (
          <div className="home-inline">
            <InlineName label="Nom de l’espace" placeholder="Ex. Mémoire sur Spinoza" onCancel={() => setCreating(false)} onSubmit={createAndOpenWorkspace} />
          </div>
        ) : (
          <button className="btn" onClick={() => setCreating(true)}>
            Créer un espace
          </button>
        )}
      </article>
      <article className="home-card home-step lift" style={{ ['--i' as string]: 2 }}>
        <span className="home-step-ico">
          <Lightbulb size={18} />
        </span>
        <h3>Charger les notions du programme</h3>
        <p>Les notions et repères de terminale, prêts à relier à vos lectures.</p>
        <button className="btn" onClick={() => navigate({ name: 'concepts', conceptId: null })}>
          Voir les notions
        </button>
      </article>
    </section>
  );
}

// ── Accueil rempli ─────────────────────────────────────────

function Dashboard() {
  const books = useStore((s) => s.books);
  const drafts = useStore((s) => s.drafts);
  const openBook = useStore((s) => s.openBook);
  const navigate = useStore((s) => s.navigate);
  const due = useDueCount();

  const lastBook = useMemo(() => {
    // « Reprendre » ne concerne que les textes : les images (photos, scans) sont exclues.
    const texts = books.filter((b) => b.format !== 'image');
    const opened = texts.filter((b) => b.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    return opened[0] ?? [...texts].sort((a, b) => b.addedAt - a.addedAt)[0] ?? null;
  }, [books]);
  const lastDraft = useMemo(() => [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null, [drafts]);

  return (
    <div className="home-dash anim-stagger">
      <section className="home-section" style={{ ['--i' as string]: 0 }} aria-label="Reprendre">
        <h2 className="home-h">Reprendre</h2>
        <div className="home-resume">
          {lastBook && (
            <button className="home-card home-resume-card lift" onClick={() => openBook(lastBook.id)}>
              <BookCover book={lastBook} size="sm" />
              <span className="home-resume-text">
                <span className="home-resume-kind muted">
                  <BookOpen size={12} /> {lastBook.lastOpenedAt ? 'Dernière lecture' : 'Dernier ajout'}
                </span>
                <span className="home-resume-title">{lastBook.title}</span>
                <span className="muted truncate">{lastBook.author || 'Auteur inconnu'}</span>
                <span className="home-progress" role="img" aria-label={`Progression ${Math.round(fraction(lastBook.progress) * 100)} %`}>
                  <span style={{ width: `${fraction(lastBook.progress) * 100}%` }} />
                </span>
                <span className="home-resume-foot muted">
                  {lastBook.lastOpenedAt
                    ? `${Math.round(fraction(lastBook.progress) * 100)} % lu · ${relativeTime(lastBook.lastOpenedAt)}`
                    : `Pas encore ouvert · ajouté ${relativeTime(lastBook.addedAt).toLowerCase()}`}
                </span>
              </span>
            </button>
          )}
          {lastDraft ? (
            <button className="home-card home-resume-card lift" onClick={() => navigate({ name: 'write', draftId: lastDraft.id })}>
              <span className="home-draft-ico">
                <FilePen size={22} />
              </span>
              <span className="home-resume-text">
                <span className="home-resume-kind muted">
                  <FilePen size={12} /> Dernier écrit
                </span>
                <span className="home-resume-title">{lastDraft.title || 'Sans titre'}</span>
                <span className="muted">{plural(lastDraft.wordCount, 'mot', 'mots')}</span>
                <span className="home-resume-foot muted">Modifié {relativeTime(lastDraft.updatedAt).toLowerCase()}</span>
              </span>
            </button>
          ) : (
            <button className="home-card home-resume-card home-resume-empty lift" onClick={() => void newDraft()}>
              <span className="home-draft-ico">
                <FilePen size={22} />
              </span>
              <span className="home-resume-text">
                <span className="home-resume-title">Pas encore d’écrit</span>
                <span className="muted">Rédigez une dissertation ou une explication de texte.</span>
                <span className="home-resume-foot">Nouvel écrit</span>
              </span>
            </button>
          )}
        </div>
      </section>

      <section className="home-section" style={{ ['--i' as string]: 1 }} aria-label="À réviser aujourd’hui">
        <div className="home-review home-card">
          <span className="home-review-ico">
            <Brain size={18} />
          </span>
          <div className="home-review-text">
            <h2 className="home-h">À réviser aujourd’hui</h2>
            <span className="muted">{due > 0 ? `${plural(due, 'carte attend', 'cartes attendent')} votre réponse.` : 'Rien à réviser pour le moment.'}</span>
          </div>
          <span className="home-review-n">{due}</span>
          <button className="btn btn-primary" disabled={due === 0} onClick={() => navigate({ name: 'revision' })}>
            Réviser
          </button>
        </div>
      </section>
    </div>
  );
}

// ── Espaces ────────────────────────────────────────────────

function Spaces({ compact }: { compact: boolean }) {
  const workspaces = useWorkspaces();
  const [creating, setCreating] = useState(false);
  if (compact && workspaces.length === 0) return null;
  return (
    <section className="home-section" aria-label="Vos espaces">
      <div className="home-h-row">
        <h2 className="home-h">Vos espaces</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>
          <Plus size={13} /> Nouvel espace
        </button>
      </div>
      <div className="home-spaces anim-stagger">
        {creating && (
          <div className="home-space home-card home-space-new">
            <InlineName label="Nom du nouvel espace" placeholder="Nom de l’espace" onCancel={() => setCreating(false)} onSubmit={(n) => (setCreating(false), createAndOpenWorkspace(n))} />
          </div>
        )}
        {workspaces.map((w, i) => (
          <SpaceCard key={w.id} id={w.id} index={i} />
        ))}
        {workspaces.length === 0 && !creating && (
          <button className="home-space home-card home-space-empty lift" onClick={() => setCreating(true)}>
            <Plus size={16} />
            <span>Créer un espace pour réunir les textes d’un même travail</span>
          </button>
        )}
      </div>
    </section>
  );
}

function SpaceCard({ id, index }: { id: string; index: number }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === id));
  const groups = useStore((s) => s.groups);
  const items = useResolvedItems(id);
  if (!ws) return null;
  const nGroups = groups.filter((g) => g.workspaceId === id).length;
  const nBooks = items.filter((i) => i.item.kind === 'book').length;
  return (
    <button className="home-space home-card lift" style={{ ['--i' as string]: index }} onClick={() => goToWorkspace(id, null)}>
      <span className="home-space-dot" style={{ background: `var(${ws.tint})` }} />
      <span className="home-space-name">{ws.name}</span>
      <span className="home-space-meta muted">
        {plural(items.length, 'élément', 'éléments')}
        {nBooks > 0 && `, dont ${plural(nBooks, 'livre', 'livres')}`}
      </span>
      <span className="home-space-meta muted">{nGroups > 0 ? plural(nGroups, 'groupe', 'groupes') : 'Aucun groupe'}</span>
    </button>
  );
}

// ── Derniers extraits ──────────────────────────────────────

function Recent() {
  const highlights = useStore((s) => s.highlights);
  const books = useStore((s) => s.books);
  const jump = useStore((s) => s.jumpToHighlight);
  const last = useMemo(() => [...highlights].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5), [highlights]);
  if (!last.length) return null;
  return (
    <section className="home-section" aria-label="Derniers extraits">
      <h2 className="home-h">Derniers extraits</h2>
      <ul className="home-recent anim-stagger">
        {last.map((h, i) => {
          const b = books.find((x) => x.id === h.bookId);
          const isNote = kindOf(h) === 'note';
          return (
            <li key={h.id} style={{ ['--i' as string]: i }}>
              <button className="home-recent-row" onClick={() => jump(h.id)}>
                <span className={`home-recent-mark ${isNote ? 'note' : ''}`} style={isNote ? undefined : { background: kindColor(h) }} title={kindLabel(h)} />
                <span className="home-recent-body">
                  <span className="home-recent-text">{h.text}</span>
                  <span className="home-recent-meta muted truncate">
                    {`${kindLabel(h)}. `}
                    {b?.title}
                    {h.locationLabel && `, ${h.locationLabel}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Raccourcis ─────────────────────────────────────────────

function Shortcuts() {
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  return (
    <section className="home-section home-shortcuts" aria-label="Raccourcis">
      <button className="btn" onClick={() => void importFirst()}>
        <Upload size={14} /> Importer <Kbd>⌘O</Kbd>
      </button>
      <button className="btn" onClick={() => void newDraft()}>
        <FilePen size={14} /> Nouvel écrit
      </button>
      <button className="btn" onClick={newPlan}>
        <ListTree size={14} /> Nouveau plan
      </button>
      <button className="btn" onClick={() => setCommandOpen(true)}>
        <Search size={14} /> Rechercher <Kbd>⌘K</Kbd>
      </button>
    </section>
  );
}
